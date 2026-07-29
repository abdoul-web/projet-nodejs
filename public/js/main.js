document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
        event.preventDefault();

        const id = button.getAttribute('data-id');
        const confirmDelete = confirm("Êtes-vous sûr de vouloir supprimer ce patient ?");
        if (confirmDelete) {
            try {
                const response = await fetch(`/patients/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    alert("Patient supprimé avec succès !");
                    window.location.reload(); // Recharger la page après suppression
                } else {
                    alert("Erreur lors de la suppression du patient.");
                }
            } catch (error) {
                console.error("Erreur :", error);
                alert("Erreur lors de la suppression.");
            }
        }
    });
});

document.querySelectorAll('.edit-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
        event.preventDefault();

        const id = button.getAttribute('data-id');
        const form = document.querySelector(`#edit-form-${id}`);
        const formData = new FormData(form);

        const data = {};
        formData.forEach((value, key) => {
            data[key] = value;
        });

        try {
            const response = await fetch(`/patients/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                alert("Patient modifié avec succès !");
                window.location.reload(); // Recharger la page après modification
            } else {
                alert("Erreur lors de la modification du patient.");
            }
        } catch (error) {
            console.error("Erreur :", error);
            alert("Erreur lors de la modification.");
        }
    });
});
