// NOTE : la route /predict qui appelait `ai_model.py` (fichier vide, jamais
// monté sur l'app Express) a été supprimée car elle était morte.
// `predictOutcome` est conservée car importée nommément par server.js.

export function predictOutcome(age, bloodPressure, cholesterolLevel) {
    // Exemple de logique de prédiction
    const risk = (bloodPressure === 'High' || cholesterolLevel === 'High') ? 'Élevé' : 'Faible';

    return {
        age: age,
        bloodPressure: bloodPressure,
        cholesterolLevel: cholesterolLevel,
        risk: risk,
    };
}
