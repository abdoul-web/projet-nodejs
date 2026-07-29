import express from 'express';
import Patient from '../models/patient.js';

const router = express.Router();

// Route pour afficher les statistiques dynamiques
router.get('/:type', async (req, res) => {
    const { type } = req.params;

    // Déterminer le champ à regrouper
    const groupByField = type === 'age' ? "$Age" : type === 'gender' ? "$Gender" : null;

    if (!groupByField) {
        return res.status(400).json({ error: "Type de statistique invalide. Utilisez 'age' ou 'gender'." });
    }

    try {
        const stats = await Patient.aggregate([
            { $group: { _id: groupByField, count: { $sum: 1 } } }
        ]);

        // Rendre la vue des statistiques
        res.render('stats', { stats, type });
    } catch (error) {
        console.error("Erreur lors de l'agrégation :", error.message);
        res.status(500).json({ error: "Erreur lors de la récupération des statistiques." });
    }
});

export default router;
