
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

exports.deleteDailyPatientQueue = onSchedule(
  {
    schedule: "59 23 * * *",
    timeZone: "Asia/Kolkata",
    region: "asia-south1",
  },
  async () => {
    const snapshot = await db.collection("registrations").get();

    let batch = db.batch();
    let count = 0;
    let deleted = 0;

    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      count++;
      deleted++;

      if (count === 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    console.log(`Queue cleanup complete. Deleted ${deleted} records.`);
  }
);
