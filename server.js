import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Patient from './models/patient.js';
import { predictOutcome } from './routes/ai.js';

const app = express();
const PORT = 3000;

// Définir __dirname pour ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));

// Connexion à MongoDB
mongoose
  .connect('mongodb://localhost:27017/medical_data', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connecté'))
  .catch((err) => console.error('Erreur de connexion MongoDB :', err.message));

// --- ROUTES ---
// Page principale
app.get('/', (req, res) => {
  res.render('index');
});

// Page des statistiques
app.get('/stats', (req, res) => {
  res.render('stats');
});

// Liste des patients
app.get('/patients', async (req, res) => {
  try {
    const patients = await Patient.find();
    res.render('patients', { patients });
  } catch (err) {
    console.error('Erreur lors de la récupération des patients :', err.message);
    res.status(500).send('Erreur lors de la récupération des patients.');
  }
});

// Ajouter un patient
app.get('/patients/add', (req, res) => {
  res.render('add_patient');
});

app.post('/patients/add', async (req, res) => {
  try {
    // Vérifiez ce qui est reçu
    console.log('Données reçues :', req.body);

    const newPatient = new Patient(req.body);
    await newPatient.save();
    res.redirect('/patients');
  } catch (err) {
    console.error('Erreur lors de l\'ajout du patient :', err.message);
    res.status(500).send('Erreur lors de l\'ajout du patient.');
  }
});



// Modifier un patient
app.get('/patients/edit/:id', async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).send('Patient non trouvé.');
    }
    res.render('edit_patient', { patient });
  } catch (err) {
    console.error('Erreur lors de la récupération du patient :', err.message);
    res.status(500).send('Erreur lors de la récupération du patient.');
  }
});

app.post('/patients/edit/:id', async (req, res) => {
  try {
    await Patient.findByIdAndUpdate(req.params.id, req.body);
    res.redirect('/patients');
  } catch (err) {
    console.error('Erreur lors de la modification du patient :', err.message);
    res.status(500).send('Erreur lors de la modification du patient.');
  }
});

// Supprimer un patient
app.get('/patients/delete/:id', async (req, res) => {
  try {
    const patient = await Patient.findByIdAndDelete(req.params.id);
    if (!patient) {
      return res.status(404).send('Patient non trouvé.');
    }
    res.redirect('/patients');
  } catch (err) {
    console.error('Erreur lors de la suppression :', err.message);
    res.status(500).send('Erreur lors de la suppression du patient.');
  }
});


// Fonction de classification
const classifyPatient = (patient) => {
  if (patient.Age > 50 && patient.BloodPressure === 'High') {
      return 'Risque élevé';
  } else if (patient.Age <= 50 && patient.CholesterolLevel === 'Normal') {
      return 'Risque faible';
  } else {
      return 'Risque modéré';
  }
};
//recherche de patients
app.get('/patients/search', async (req, res) => {
  const searchCriteria = {};

  // Ajoutez les critères de recherche dynamiquement
  if (req.query.Disease) searchCriteria.Disease = { $regex: req.query.Disease, $options: 'i' };
  if (req.query.Gender) searchCriteria.Gender = req.query.Gender;
  if (req.query.Age) searchCriteria.Age = parseInt(req.query.Age);

  try {
      const patients = await Patient.find(searchCriteria);

      // Ajoutez une classification pour chaque patient
      const classifiedPatients = patients.map(patient => {
          const classification = classifyPatient(patient); // Utilise la fonction définie
          return { ...patient.toObject(), classification };
      });

      // Renvoyez les résultats vers la vue
      res.render('patients_search_results', { patients: classifiedPatients });
  } catch (err) {
      console.error('Erreur lors de la recherche des patients :', err.message);
      res.status(500).send('Erreur lors de la recherche des patients.');
  }
});


app.get('/patients/stats/:type', async (req, res) => {
    const { type } = req.params;
    const groupByField = {
        age: "$Age",
        gender: "$Gender",
        disease: "$Disease",
    }[type];

    if (!groupByField) {
        return res.status(400).json({ error: "Type de statistique invalide." });
    }

    try {
        const stats = await Patient.aggregate([
            { $group: { _id: groupByField, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);
        res.json(stats);
    } catch (err) {
        console.error("Erreur lors de la récupération des statistiques :", err.message);
        res.status(500).json({ error: "Erreur interne." });
    }
});


// Exécuter les modèles de machine learning
//n'est plus utilisé
app.get('/run-models', (req, res) => {
  const pythonScript = path.join(__dirname, 'ml_model.py');

  exec(`python ${pythonScript}`, (error, stdout, stderr) => {
    if (error) {
      console.error('Erreur lors de l\'exécution du script :', error.message);
      return res.status(500).send('Erreur lors de l\'exécution du modèle.');
    }

    if (stderr) {
      console.error('Erreur du script Python :', stderr);
      return res.status(500).send('Erreur dans le script Python.');
    }

    console.log('Résultats du script Python :', stdout);
    res.redirect('/results');
  });
});
//
// Afficher les résultats
// Route pour les statistiques du tableau de bord
app.get('/dashboard/stats', async (req, res) => {
  try {
    const totalPatients = await Patient.countDocuments();
    const mostCommonDisease = await Patient.aggregate([
      { $group: { _id: '$Disease', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    const criticalPatients = await Patient.countDocuments({
      $or: [
        { blood_pressure: 'High' },
        { cholesterol_level: 'High' }
      ]
    });
    const recoveredPatients = await Patient.countDocuments({
      $and: [
        { blood_pressure: 'Normal' },
        { cholesterol_level: 'Normal' }
      ]
    });

    res.json({
      totalPatients,
      mostCommonDisease: mostCommonDisease.length > 0 ? mostCommonDisease[0]._id : 'Aucune donnée',
      criticalPatients,
      recoveredPatients
    });
  } catch (err) {
    console.error('Erreur lors de la récupération des statistiques du tableau de bord :', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Page de prédiction
app.get('/predict', (req, res) => {
  res.render('predict');
});

// Route POST pour les prédictions
app.post('/ai/predict', (req, res) => {
  const { age, bloodPressure, cholesterolLevel } = req.body;

  if (!age || !bloodPressure || !cholesterolLevel) {
    return res.status(400).json({ error: "Les champs âge, pression artérielle et cholestérol sont requis." });
  }

  // Commande pour exécuter le script Python
  const command = `python ${path.join(__dirname, 'ml_model.py')} ${age} ${bloodPressure} ${cholesterolLevel}`;

  // Exécuter le script
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Erreur lors de l'exécution du script Python :", stderr);
      return res.status(500).json({ error: "Erreur lors de l'exécution du script Python." });
    }

    try {
      const result = JSON.parse(stdout.trim()); // Analyse de la sortie JSON
      res.render('predict_result', {
        age, // Transmettre l'âge
        bloodPressure, // Transmettre la pression artérielle
        cholesterolLevel, // Transmettre le niveau de cholestérol
        risk: result.risk || "Indéterminé", // Résultat du script Python
        score: result.score || 0 // Résultat du script Python
      });
    } catch (parseError) {
      console.error("Erreur de parsing JSON :", parseError.message);
      res.status(500).json({ error: "Erreur dans le traitement des résultats." });
    }
  });
});

// Route pour les résultats des modèles
app.get('/results', (req, res) => {
    const resultsPath = path.join(__dirname, 'public/results');

    fs.readdir(resultsPath, (err, files) => {
        if (err) {
            console.error('Erreur lors de la lecture des fichiers :', err);
            return res.status(500).send('Erreur interne du serveur');
        }

        // Filtrer uniquement les fichiers PNG
        const images = files.filter(file => file.endsWith('.png'));
        res.render('results', { images }); // Rendre la vue avec les images
    });
});


// Lancer le serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

// Middleware pour capturer les erreurs
app.use((err, req, res, next) => {
  console.error("Une erreur s'est produite :", err.message);
  res.status(500).send('Erreur interne du serveur.');
});