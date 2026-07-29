"""
Modèle de prédiction du risque patient.

Usage (CONTRAT CLI INCHANGÉ - utilisé par server.js:253) :
    python ml_model.py <age> <blood_pressure> <cholesterol_level>
        -> imprime sur stdout un JSON {"risk": "...", "score": ...}

Usage supplémentaire (entraînement) :
    python ml_model.py train
        -> charge les patients depuis MongoDB, compare LogisticRegression et
           RandomForest en validation croisée 5 plis (ROC-AUC), garde le
           meilleur, l'évalue sur un jeu de test isolé, écrit les métriques
           et la courbe ROC, puis sauvegarde le pipeline final avec joblib.
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "ml_artifacts" / "model.joblib"
RESULTS_DIR = BASE_DIR / "public" / "results"
MONGO_URI = "mongodb://localhost:27017/medical_data"
COLLECTION_NAME = "patients"

FEATURE_COLUMNS = ["Age", "blood_pressure_code", "cholesterol_level_code"]
TARGET_COLUMN = "OutcomeVariable"

# Encodage ordinal des variables catégorielles. On réutilise le mapping déjà
# utilisé historiquement (Low < Normal < High) pour rester cohérent entre
# l'entraînement et la prédiction en ligne de commande.
CATEGORY_MAPPING = {"Low": 0, "Normal": 1, "High": 2}


def _encode_category(value):
    """Convertit 'Low'/'Normal'/'High' en code ordinal ; None/inconnu -> NaN
    (géré ensuite par l'imputer du pipeline)."""
    return CATEGORY_MAPPING.get(value, np.nan)


def load_patients_from_mongo():
    """Charge la collection `patients` de MongoDB dans un DataFrame."""
    from pymongo import MongoClient

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    collection = client.get_default_database()[COLLECTION_NAME]
    docs = list(collection.find({}, {"Age": 1, "blood_pressure": 1, "cholesterol_level": 1, "OutcomeVariable": 1}))
    client.close()
    return pd.DataFrame(docs)


def build_features(df):
    """Construit la matrice de features (Age, codes catégoriels) à partir
    du DataFrame brut. Les valeurs manquantes restent NaN : c'est
    l'imputer du pipeline scikit-learn qui s'en charge (fit uniquement sur
    les plis d'entraînement, pas de fuite de données)."""
    X = pd.DataFrame(
        {
            "Age": pd.to_numeric(df["Age"], errors="coerce"),
            "blood_pressure_code": df["blood_pressure"].map(_encode_category),
            "cholesterol_level_code": df["cholesterol_level"].map(_encode_category),
        }
    )
    return X[FEATURE_COLUMNS]


def build_pipeline(model):
    """Pipeline commun : imputation puis (pour les modèles sensibles à
    l'échelle) mise à l'échelle, puis le classifieur."""
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    preprocessor = ColumnTransformer(
        transformers=[
            ("age", SimpleImputer(strategy="median"), ["Age"]),
            (
                "categorical_codes",
                SimpleImputer(strategy="most_frequent"),
                ["blood_pressure_code", "cholesterol_level_code"],
            ),
        ]
    )

    return Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("scale", StandardScaler()),
            ("model", model),
        ]
    )


def train():
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        ConfusionMatrixDisplay,
        confusion_matrix,
        f1_score,
        precision_score,
        recall_score,
        roc_auc_score,
        roc_curve,
    )
    from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

    print(f"Connexion a MongoDB ({MONGO_URI}, collection '{COLLECTION_NAME}')...")
    raw = load_patients_from_mongo()
    print(f"{len(raw)} documents charges depuis MongoDB.")

    raw = raw.dropna(subset=[TARGET_COLUMN])
    print(f"{len(raw)} lignes conservees apres exclusion des cibles manquantes ({TARGET_COLUMN} absent).")

    X = build_features(raw)
    y = raw[TARGET_COLUMN].astype(int)

    n_missing_bp = X["blood_pressure_code"].isna().sum()
    n_missing_chol = X["cholesterol_level_code"].isna().sum()
    n_missing_age = X["Age"].isna().sum()
    print(
        f"Valeurs manquantes -> Age: {n_missing_age}, blood_pressure: {n_missing_bp}, "
        f"cholesterol_level: {n_missing_chol} (imputees dans le pipeline, fit sur le train uniquement)."
    )

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"Split train/test : {len(X_train)} train / {len(X_test)} test (stratifie sur {TARGET_COLUMN}).")

    candidates = {
        "LogisticRegression": LogisticRegression(max_iter=1000, random_state=42),
        "RandomForest": RandomForestClassifier(n_estimators=300, random_state=42),
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_summary = {}
    best_name, best_pipeline, best_mean_auc = None, None, -np.inf

    print("\nValidation croisee 5 plis (ROC-AUC) :")
    for name, model in candidates.items():
        pipeline = build_pipeline(model)
        scores = cross_val_score(pipeline, X_train, y_train, cv=cv, scoring="roc_auc")
        mean_auc, std_auc = scores.mean(), scores.std()
        cv_summary[name] = {"roc_auc_mean": float(mean_auc), "roc_auc_std": float(std_auc)}
        print(f"  - {name}: AUC = {mean_auc:.4f} (+/- {std_auc:.4f})")
        if mean_auc > best_mean_auc:
            best_name, best_pipeline, best_mean_auc = name, pipeline, mean_auc

    print(f"\nModele retenu : {best_name} (AUC CV moyen = {best_mean_auc:.4f})")

    # Evaluation honnête sur le jeu de test isolé (jamais vu pendant la CV).
    best_pipeline.fit(X_train, y_train)
    y_pred = best_pipeline.predict(X_test)
    y_proba = best_pipeline.predict_proba(X_test)[:, 1]

    test_metrics = {
        "f1_score": float(f1_score(y_test, y_pred)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred)),
        "confusion_matrix": confusion_matrix(y_test, y_pred).tolist(),
    }

    print("\nMetriques sur le jeu de test (20% jamais vu) :")
    for key, value in test_metrics.items():
        print(f"  - {key}: {value}")

    # Courbe ROC (calculée sur le jeu de test isolé).
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    fpr, tpr, _ = roc_curve(y_test, y_proba)
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.figure(figsize=(7, 6))
    plt.plot(fpr, tpr, color="blue", label=f"{best_name} (AUC = {test_metrics['roc_auc']:.3f})")
    plt.plot([0, 1], [0, 1], "k--", color="grey", label="Hasard")
    plt.xlabel("Taux de faux positifs")
    plt.ylabel("Taux de vrais positifs")
    plt.title("Courbe ROC - jeu de test")
    plt.legend()
    plt.grid(True)
    roc_path = RESULTS_DIR / "roc_curve.png"
    plt.savefig(roc_path)
    plt.close()

    cm_disp = ConfusionMatrixDisplay(
        confusion_matrix=np.array(test_metrics["confusion_matrix"]), display_labels=["Faible (0)", "Eleve (1)"]
    )
    cm_disp.plot(cmap="Blues")
    plt.title(f"Matrice de confusion - {best_name}")
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "confusion_matrix.png")
    plt.close()

    metrics_payload = {
        "best_model": best_name,
        "cross_validation": cv_summary,
        "test_metrics": test_metrics,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_total_labeled": int(len(X)),
    }
    with open(RESULTS_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics_payload, f, indent=2, ensure_ascii=False)
    print(f"\nMetriques ecrites dans {RESULTS_DIR / 'metrics.json'}")
    print(f"Courbe ROC enregistree dans {roc_path}")

    # Le modèle sauvegardé pour la production est ré-entraîné sur
    # l'intégralité des données étiquetées disponibles (train + test), afin
    # d'exploiter tout le signal disponible pour les prédictions réelles.
    # Les métriques ci-dessus, elles, restent celles mesurées sur le jeu de
    # test tenu à l'écart pendant cet entraînement final.
    best_pipeline.fit(X, y)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": best_pipeline, "model_name": best_name}, MODEL_PATH)
    print(f"Modele final ({best_name}, entraine sur {len(X)} patients) sauvegarde dans {MODEL_PATH}")

    return metrics_payload


def predict(age, blood_pressure, cholesterol_level):
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Aucun modele entraine trouve ({MODEL_PATH}). Lancez d'abord "
            "'python ml_model.py train'."
        )

    artifact = joblib.load(MODEL_PATH)
    pipeline = artifact["pipeline"]

    row = pd.DataFrame(
        [
            {
                "Age": float(age),
                "blood_pressure_code": _encode_category(blood_pressure),
                "cholesterol_level_code": _encode_category(cholesterol_level),
            }
        ]
    )[FEATURE_COLUMNS]

    proba_high_risk = float(pipeline.predict_proba(row)[0, 1])
    score = round(proba_high_risk * 100)
    risk = "Élevé" if score >= 50 else "Faible"

    return {"risk": risk, "score": score}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        try:
            train()
        except Exception as e:
            print(f"Erreur : {e}")
            sys.exit(1)
    elif len(sys.argv) == 4:
        try:
            age = int(sys.argv[1])
            blood_pressure = sys.argv[2]
            cholesterol_level = sys.argv[3]
            result = predict(age, blood_pressure, cholesterol_level)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
    else:
        print("Usage :")
        print("  python ml_model.py train   # Pour entrainer le modele")
        print("  python ml_model.py <age> <blood_pressure> <cholesterol_level>   # Pour predire")
