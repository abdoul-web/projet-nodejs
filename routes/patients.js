import express from 'express';
import Patient from '../models/patient.js';

const router = express.Router();

// Route pour récupérer tous les patients
router.get('/', async (req, res) => {
    try {
        const patients = await Patient.find();
        res.render('patients', { patients });
    } catch (err) {
        console.error("Erreur lors de la récupération des patients :", err.message);
        res.status(500).send("Erreur lors de la récupération des patients.");
    }
});

// Recherche de patients
router.get('/search', async (req, res) => {
    const {
        Disease,
        Fever,
        Cough,
        Fatigue,
        Age,
        Gender,
        blood_pressure,
        cholesterol_level,
        difficulty_breathing
    } = req.query;

    const searchCriteria = {};

    if (Disease) searchCriteria.Disease = { $regex: Disease, $options: 'i' };
    if (Fever) searchCriteria.Fever = Fever;
    if (Cough) searchCriteria.Cough = Cough;
    if (Fatigue) searchCriteria.Fatigue = Fatigue;
    if (Age) searchCriteria.Age = parseInt(Age, 10);
    if (Gender) searchCriteria.Gender = Gender;
    if (blood_pressure) searchCriteria.blood_pressure = blood_pressure;
    if (cholesterol_level) searchCriteria.cholesterol_level = cholesterol_level;
    if (difficulty_breathing) searchCriteria.difficulty_breathing = difficulty_breathing;

    try {
        const patients = await Patient.find(searchCriteria);
        res.render('patients', { patients });
    } catch (err) {
        console.error("Erreur lors de la recherche :", err.message);
        res.status(500).send("Erreur lors de la recherche des patients.");
    }
});

// Ajout d'un patient
router.post('/add', async (req, res) => {
    try {
        const newPatient = new Patient(req.body);
        await newPatient.save();
        res.redirect('/patients');
    } catch (err) {
        console.error("Erreur lors de l'ajout du patient :", err.message);
        res.status(500).send("Erreur lors de l'ajout du patient.");
    }
});

// Modification d'un patient
router.post('/edit/:id', async (req, res) => {
    try {
        await Patient.findByIdAndUpdate(req.params.id, req.body);
        res.redirect('/patients');
    } catch (err) {
        console.error("Erreur lors de la modification du patient :", err.message);
        res.status(500).send("Erreur lors de la modification du patient.");
    }
});

// Suppression d'un patient
router.get('/delete/:id', async (req, res) => {
    try {
        const patient = await Patient.findByIdAndDelete(req.params.id);
        if (!patient) {
            return res.status(404).send("Patient non trouvé.");
        }
        res.redirect('/patients');
    } catch (err) {
        console.error("Erreur lors de la suppression :", err.message);
        res.status(500).send("Erreur lors de la suppression du patient.");
    }
});

export default router;
