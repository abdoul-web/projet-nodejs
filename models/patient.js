import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema({
    Disease: String,
    Fever: String,
    Cough: String,
    Fatigue: String,
    Age: Number,
    Gender: String,
    blood_pressure: String,
    cholesterol_level: String,
    difficulty_breathing: String,
    OutcomeVariable: Number
});

const Patient = mongoose.model('Patient', patientSchema);

export default Patient;
