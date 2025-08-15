// This file contains the logic for the core_settings.html page.

document.addEventListener("DOMContentLoaded", function () {
  const settingsForm = document.getElementById("settingsForm");
  const settingsRef = db.collection("settings").doc("deductions");

  /**
   * Fetches the current settings from Firebase and populates the form inputs.
   */
  async function loadSettings() {
    try {
      const doc = await settingsRef.get();
      if (doc.exists) {
        const data = doc.data();
        document.querySelector('input[name="kasarPercentage"]').value = data.kasarPercentage;
        document.querySelector('input[name="kantanWeight"]').value = data.kantanWeight;
        document.querySelector('input[name="plasticWeight"]').value = data.plasticWeight;
        document.querySelector('input[name="utraiPercentage"]').value = data.utraiPercentage;
      } else {
        alert("Settings not found. Using default values.");
      }
    } catch (error) {
      console.error("Error loading settings:", error);
      alert("Could not load settings. Please try again.");
    }
  }

  /**
   * Handles form submission, updating the settings document in Firebase.
   */
  settingsForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const newSettings = {
      kasarPercentage: Number(document.querySelector('input[name="kasarPercentage"]').value),
      kantanWeight: Number(document.querySelector('input[name="kantanWeight"]').value),
      plasticWeight: Number(document.querySelector('input[name="plasticWeight"]').value),
      utraiPercentage: Number(document.querySelector('input[name="utraiPercentage"]').value),
    };

    try {
      await settingsRef.set(newSettings); // Use .set() to overwrite or create
      alert("Settings saved successfully!");
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Could not save settings. Please try again.");
    }
  });

  loadSettings();
});
