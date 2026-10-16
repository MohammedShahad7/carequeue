
import { useEffect, useRef, useState } from "react";

import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { auth, db, patientAuth, patientDb } from "./firebase";

import {
  Activity,
  ArrowRight,
  CheckCircle,
  Clock,
  HeartPulse,
  Hospital,
  LayoutDashboard,
  Plus,
  Stethoscope,
  Users,
  UserRound,
  Trash2,
  BellRing,
  Volume2,
  VolumeX,
} from "lucide-react";

import "./index.css";

const departments = [
  { name: "General Medicine", code: "GM", icon: Stethoscope },
  { name: "Pediatrics", code: "PD", icon: HeartPulse },
  { name: "Orthopedics", code: "OR", icon: Activity },
];

const TOKEN_STORAGE_KEY = "carequeue_latest_token";
const SOUND_STORAGE_KEY = "carequeue_sound_enabled";
const AVERAGE_CONSULTATION_MINUTES = 10;

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [patientAuthReady, setPatientAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  const [staffVerified, setStaffVerified] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffError, setStaffError] = useState("");

  const [page, setPage] = useState("patient");
  const [patients, setPatients] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [clearingQueue, setClearingQueue] = useState(false);
  const [updatingPatients, setUpdatingPatients] = useState([]);

  const [name, setName] = useState("");
  const [department, setDepartment] = useState("General Medicine");

  const [latestToken, setLatestToken] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY)) || null;
    } catch {
      return null;
    }
  });

  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_STORAGE_KEY) === "true"
  );

  const [notice, setNotice] = useState("");
  const [registering, setRegistering] = useState(false);

  const [notificationPermission, setNotificationPermission] =
    useState(() =>
      "Notification" in window
        ? Notification.permission
        : "unsupported"
    );

  const previousStatusRef = useRef({});
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (latestToken) {
      localStorage.setItem(
        TOKEN_STORAGE_KEY,
        JSON.stringify(latestToken)
      );
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [latestToken]);

  useEffect(() => {
    localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
  }, [soundEnabled]);

  // Verify staff access using the staff collection.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setStaffVerified(false);

      if (!user) {
        setAuthReady(true);
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, "staff", user.uid));

        const authorized =
          snapshot.exists() &&
          snapshot.data().role === "staff" &&
          snapshot.data().active === true;

        setStaffVerified(authorized);

        if (!authorized) {
          setStaffError(
            "This account is not authorized for staff access."
          );
          await signOut(auth);
        } else {
          setStaffError("");
        }
      } catch (error) {
        console.error("Staff verification failed:", error);
        setStaffError("Could not verify staff permissions.");

        try {
          await signOut(auth);
        } catch (logoutError) {
          console.error(logoutError);
        }
      } finally {
        setAuthReady(true);
      }
    });

    return unsubscribe;
  }, []);

  // Anonymous authentication for patients.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      patientAuth,
      async (user) => {
        if (user) {
          setPatientAuthReady(true);
          setAuthError("");
          return;
        }

        setPatientAuthReady(false);

        try {
          await signInAnonymously(patientAuth);
        } catch (error) {
          console.error("Patient sign-in failed:", error);
          setAuthError(
            "Patient sign-in failed. Enable Anonymous sign-in in Firebase Authentication."
          );
        }
      }
    );

    return unsubscribe;
  }, []);

  // Staff sees the full queue. Patients see only their own registrations.
  useEffect(() => {
    if (!authReady) return;

    let queueQuery;

    if (page === "admin") {
      if (!staffVerified) {
        setPatients([]);
        setQueueLoading(false);
        return;
      }

      queueQuery = collection(db, "registrations");
    } else {
      if (!patientAuthReady || !patientAuth.currentUser) return;

      queueQuery = query(
        collection(patientDb, "registrations"),
        where("ownerUid", "==", patientAuth.currentUser.uid)
      );
    }

    setQueueLoading(true);
    setQueueError("");

    const unsubscribe = onSnapshot(
      queueQuery,
      (snapshot) => {
        const loadedPatients = snapshot.docs.map((item) => {
          const data = item.data();

          const createdAt = data.createdAt?.toDate
            ? data.createdAt.toDate()
            : null;

          return {
            id: item.id,
            name: data.patientName,
            department:
              departments.find((d) => d.code === data.department)?.name ||
              data.department,
            departmentCode: data.department,
            token: data.token,
            status: data.status,
            ownerUid: data.ownerUid,
            createdAt,
            time: createdAt
              ? createdAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Pending",
          };
        });

        setPatients(loadedPatients);
        setQueueLoading(false);
      },
      (error) => {
        console.error("Queue loading failed:", error);
        setQueueError(
          "Unable to load queue. Check Firestore permissions and connection."
        );
        setQueueLoading(false);
      }
    );

    return unsubscribe;
  }, [authReady, patientAuthReady, page, staffVerified]);

  const sortedPatients = [...patients].sort((a, b) => {
    const aTime = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  const latestTokenPatient = latestToken
    ? patients.find((patient) => patient.id === latestToken.id)
    : null;

  // Notify the patient when their status changes to Called.
  useEffect(() => {
    if (page !== "patient" || !latestTokenPatient) return;

    const patient = latestTokenPatient;
    const previousStatus = previousStatusRef.current[patient.id];

    if (
      patient.status === "Called" &&
      previousStatus &&
      previousStatus !== "Called"
    ) {
      if (soundEnabled) playNotificationSound();

      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("CareQueue: Your turn!", {
            body: `Token ${patient.token}: Please proceed to the doctor's room.`,
            tag: `carequeue-${patient.id}`,
          });
        } catch (error) {
          console.warn("Browser notification failed:", error);
        }
      }
    }

    previousStatusRef.current[patient.id] = patient.status;
  }, [page, latestTokenPatient, soundEnabled]);

  function playNotificationSound() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      const context =
        audioContextRef.current || new AudioContextClass();

      audioContextRef.current = context;

      if (context.state === "suspended") {
        context.resume().catch(console.warn);
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(
        660,
        context.currentTime + 0.18
      );

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.18,
        context.currentTime + 0.03
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.45
      );

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.46);
    } catch (error) {
      console.warn("Sound notification failed:", error);
    }
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      setNotice(
        permission === "granted"
          ? "Browser notifications enabled."
          : "Notifications not enabled. You can still see alerts in CareQueue."
      );
    } catch (error) {
      console.error(error);
      setNotice("Could not enable browser notifications.");
    }
  }

  function openStaffPortal() {
    setPage("admin");
    setNotice("");
    setStaffError("");
  }

  async function handleStaffLogin(event) {
    event.preventDefault();
    setStaffError("");
    setStaffLoading(true);

    try {
      await signInWithEmailAndPassword(
        auth,
        staffEmail.trim(),
        staffPassword
      );
      setStaffPassword("");
    } catch (error) {
      console.error("Staff login failed:", error);

      setStaffError(
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
          ? "Incorrect email or password."
          : error.code === "auth/too-many-requests"
          ? "Too many attempts. Please wait and try again."
          : error.message || "Staff login failed."
      );
    } finally {
      setStaffLoading(false);
    }
  }

  async function handleStaffLogout() {
    try {
      await signOut(auth);
      setStaffVerified(false);
      setStaffPassword("");
      setPage("patient");
      setNotice("");
    } catch (error) {
      console.error(error);
      setStaffError("Logout failed. Please refresh the page.");
    }
  }

  async function registerPatient(event) {
    event.preventDefault();

    if (!name.trim()) {
      setNotice("Please enter the patient's name.");
      return;
    }

    if (!patientAuthReady || !patientAuth.currentUser) {
      setNotice("Patient sign-in is still loading. Please try again.");
      return;
    }

    const selectedDepartment = departments.find(
      (item) => item.name === department
    );

    if (!selectedDepartment) {
      setNotice("Please select a valid department.");
      return;
    }

    setRegistering(true);
    setNotice("Registering your token...");

    try {
      const user = patientAuth.currentUser;
      const registrationRef = doc(collection(patientDb, "registrations"));

      const token =
        selectedDepartment.code +
        "-" +
        registrationRef.id.slice(0, 8).toUpperCase();

      await setDoc(registrationRef, {
        ownerUid: user.uid,
        patientName: name.trim(),
        department: selectedDepartment.code,
        token,
        status: "Waiting",
        createdAt: serverTimestamp(),
      });

      const newToken = {
        id: registrationRef.id,
        name: name.trim(),
        department,
        departmentCode: selectedDepartment.code,
        token,
        status: "Waiting",
      };

      setLatestToken(newToken);
      previousStatusRef.current[registrationRef.id] = "Waiting";
      setName("");
      setNotice(`Registration successful! Your token is ${token}.`);
    } catch (error) {
      console.error("Registration failed:", error);
      setNotice(
        "Registration failed: " +
          (error.code === "permission-denied"
            ? "Firestore rules blocked this registration."
            : error.message || "Please try again.")
      );
    } finally {
      setRegistering(false);
    }
  }

  async function updateStatus(id, status) {
    if (!staffVerified) {
      setNotice("Only authorized staff can update queue status.");
      return;
    }

    if (!["Waiting", "Called", "Completed"].includes(status)) return;
    if (updatingPatients.includes(id)) return;

    setUpdatingPatients((current) => [...current, id]);

    try {
      await updateDoc(doc(db, "registrations", id), { status });
      setNotice("Queue status updated to " + status + ".");
    } catch (error) {
      console.error("Status update failed:", error);
      setNotice("Could not update status. Check Firestore rules.");
    } finally {
      setUpdatingPatients((current) =>
        current.filter((patientId) => patientId !== id)
      );
    }
  }

  async function clearPatientQueue() {
    if (!staffVerified || clearingQueue) {
      setNotice("Only authorized staff can clear the queue.");
      return;
    }

    if (
      !window.confirm(
        "Delete ALL patient registrations, including completed records? This cannot be undone."
      )
    ) {
      return;
    }

    setClearingQueue(true);

    try {
      const snapshot = await getDocs(collection(db, "registrations"));

      for (let i = 0; i < snapshot.docs.length; i += 400) {
        const batch = writeBatch(db);

        snapshot.docs.slice(i, i + 400).forEach((patientDoc) => {
          batch.delete(patientDoc.ref);
        });

        await batch.commit();
      }

      setLatestToken(null);
      setNotice(`Queue cleared. Deleted ${snapshot.size} registration(s).`);
    } catch (error) {
      console.error("Clear queue failed:", error);
      setNotice("Could not clear the queue. Check Firestore rules.");
    } finally {
      setClearingQueue(false);
    }
  }

  async function callNext(departmentName) {
    if (!staffVerified) return;

    const nextPatient = sortedPatients.find(
      (patient) =>
        patient.department === departmentName &&
        patient.status === "Waiting"
    );

    if (!nextPatient) {
      setNotice("No waiting patients in " + departmentName + ".");
      return;
    }

    await updateStatus(nextPatient.id, "Called");
  }

  const waitingPatients = patients.filter(
    (patient) => patient.status === "Waiting"
  );

  const completedPatients = patients.filter(
    (patient) => patient.status === "Completed"
  );

  const departmentWaitingCounts = departments.reduce((counts, item) => {
    counts[item.name] = patients.filter(
      (patient) =>
        patient.department === item.name &&
        patient.status === "Waiting"
    ).length;

    return counts;
  }, {});

  // Approximate estimate using the registrations visible to this view.
  // Accurate patient-side estimates require a shared, privacy-safe queue summary.
  const patientsAhead = latestTokenPatient?.status === "Waiting"
    ? sortedPatients.filter(
        (patient) =>
          patient.department === latestTokenPatient.department &&
          patient.status === "Waiting" &&
          patient.createdAt &&
          latestTokenPatient.createdAt &&
          patient.createdAt < latestTokenPatient.createdAt
      ).length
    : 0;

  const estimatedWaitMinutes =
    patientsAhead * AVERAGE_CONSULTATION_MINUTES;

  const estimatedCallTime = new Date(
    Date.now() + estimatedWaitMinutes * 60 * 1000
  );

  if (!authReady) {
    return (
      <div className="app-shell">
        <main className="main-content">
          <p>Connecting securely to CareQueue...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            setPage("patient");
            setNotice("");
          }}
        >
          <span className="brand-icon">
            <Hospital size={23} />
          </span>
          <span>
            Care<span className="brand-accent">Queue</span>
            <small>SMART HOSPITAL SYSTEM</small>
          </span>
        </button>

        <nav className="nav-links">
          <button
            className={page === "patient" ? "nav-link active" : "nav-link"}
            onClick={() => setPage("patient")}
          >
            Patient Portal
          </button>

          <button
            className={page === "admin" ? "nav-link active" : "nav-link"}
            onClick={openStaffPortal}
          >
            <LayoutDashboard size={16} />
            Staff Dashboard
          </button>
        </nav>

        <div className="system-status">
          <span /> Live Queue
        </div>
      </header>

      <main className="main-content">
        {page === "admin" && !staffVerified ? (
          <section className="staff-login-page">
            <div className="staff-login-card">
              <div className="staff-login-icon">
                <Hospital size={32} />
              </div>

              <span className="staff-login-label">
                CAREQUEUE STAFF PORTAL
              </span>

              <h2>Welcome back</h2>
              <p className="staff-login-description">
                Sign in to manage hospital queues and patient flow.
              </p>

              <form onSubmit={handleStaffLogin}>
                <label htmlFor="staffEmail">Email address</label>
                <input
                  id="staffEmail"
                  type="email"
                  value={staffEmail}
                  onChange={(event) => setStaffEmail(event.target.value)}
                  placeholder="Enter your staff email"
                  autoComplete="username"
                  required
                />

                <label htmlFor="staffPassword">Password</label>
                <input
                  id="staffPassword"
                  type="password"
                  value={staffPassword}
                  onChange={(event) => setStaffPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />

                {staffError && (
                  <p className="staff-login-error" role="alert">
                    {staffError}
                  </p>
                )}

                <button
                  type="submit"
                  className="staff-login-button"
                  disabled={staffLoading}
                >
                  {staffLoading ? "Verifying..." : "Sign in to dashboard"}
                  {!staffLoading && <ArrowRight size={18} />}
                </button>
              </form>

              <div className="staff-security-note">
                <CheckCircle size={16} />
                Authorized staff access only
              </div>
            </div>
          </section>
        ) : page === "patient" ? (
          <>
            <section className="welcome-section">
              <div>
                <div className="eyebrow">
                  <HeartPulse size={15} />
                  HEALTHCARE, MADE SIMPLER
                </div>

                <h1>
                  Less waiting.
                  <br />
                  <span>More caring.</span>
                </h1>

                <p>
                  Join your hospital queue digitally and track your token.
                </p>
              </div>

              <div className="welcome-art">
                <Hospital size={88} strokeWidth={1.1} />
                <HeartPulse className="floating-heart" size={34} />
              </div>
            </section>

            <div className="section-heading">
              <div>
                <h2>Get your token</h2>
                <p>Enter your name and select a department.</p>
              </div>
              <span className="step-label">STEP 01 / REGISTER</span>
            </div>

            <div className="patient-layout">
              <section className="panel">
                <form onSubmit={registerPatient}>
                  <label htmlFor="patientName">Patient name</label>

                  <div className="input-wrap">
                    <UserRound size={18} />
                    <input
                      id="patientName"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Enter patient name"
                      required
                    />
                  </div>

                  <label>Choose department</label>

                  <div className="department-options">
                    {departments.map((item) => {
                      const Icon = item.icon;

                      return (
                        <button
                          type="button"
                          key={item.code}
                          className={
                            department === item.name
                              ? "department-option selected"
                              : "department-option"
                          }
                          onClick={() => setDepartment(item.name)}
                        >
                          <Icon size={21} />
                          <span>{item.name}</span>
                          <span className="radio-dot" />
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={registering || !patientAuthReady}
                  >
                    <Plus size={18} />
                    {registering ? "Registering..." : "Get my token"}
                    {!registering && <ArrowRight size={17} />}
                  </button>

                  <p className="privacy-note">
                    <CheckCircle size={14} />
                    Demo only. Do not enter real medical data.
                  </p>
                </form>

                <div className="notification-settings">
                  <h3>
                    <BellRing size={18} />
                    Smart Turn Notifications
                  </h3>

                  <p>Get an alert when staff calls your token.</p>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSoundEnabled((value) => !value)}
                  >
                    {soundEnabled ? (
                      <Volume2 size={16} />
                    ) : (
                      <VolumeX size={16} />
                    )}
                    {soundEnabled ? "Sound enabled" : "Enable sound"}
                  </button>

                  <button
                    type="button"
                    className="secondary-button notification-permission-button"
                    onClick={enableBrowserNotifications}
                    disabled={notificationPermission === "granted"}
                  >
                    <BellRing size={16} />
                    {notificationPermission === "granted"
                      ? "Browser notifications enabled"
                      : notificationPermission === "denied"
                      ? "Allow notifications in browser settings"
                      : notificationPermission === "unsupported"
                      ? "Browser notifications unsupported"
                      : "Enable browser notifications"}
                  </button>

                  {notificationPermission === "denied" && (
                    <p className="notification-help">
                      Notifications are blocked. Change this website's
                      notification permission in your browser settings.
                    </p>
                  )}
                </div>

                {authError && (
                  <div className="notice" role="alert">{authError}</div>
                )}

                {notice && <div className="notice">{notice}</div>}

                {latestToken && (
                  <div className="token-result">
                    <div className="token-success">
                      <CheckCircle size={18} />
                      Your saved token
                    </div>

                    <div className="token-number">{latestToken.token}</div>

                    <p>
                      {latestToken.name}, your department is{" "}
                      {latestToken.department}.
                    </p>

                    {latestTokenPatient?.status === "Called" && (
                      <div className="doctor-calling-message" role="alert">
                        🔔 Doctor is calling you!
                        <p>Please proceed to the doctor's room.</p>
                      </div>
                    )}

                    {latestTokenPatient?.status === "Completed" && (
                      <div className="completed-notice">
                        <CheckCircle size={18} />
                        Your visit has been marked completed.
                      </div>
                    )}

                    {latestTokenPatient?.status === "Waiting" && (
                      <>
                        <div className="waiting-notice">
                          <Clock size={17} />
                          Your token is waiting to be called.
                        </div>

                        <div className="waiting-time-card">
                          <h3><Clock size={18} /> Estimated Waiting Time</h3>

                          <div className="waiting-time-value">
                            {estimatedWaitMinutes} minutes
                          </div>

                          <div className="waiting-time-detail">
                            <span>Patients ahead</span>
                            <strong>{patientsAhead}</strong>
                          </div>

                          <div className="waiting-time-detail">
                            <span>Estimated call time</span>
                            <strong>
                              {estimatedCallTime.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </strong>
                          </div>

                          <p>
                            Based on an average of{" "}
                            {AVERAGE_CONSULTATION_MINUTES} minutes per patient.
                            Actual waiting time may vary.
                          </p>
                        </div>
                      </>
                    )}

                    <div className="token-details">
                      <span>
                        <Users size={15} />
                        {departmentWaitingCounts[latestToken.department] || 0}{" "}
                        waiting in your department
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <aside className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="mini-label">QUEUE OVERVIEW</span>
                    <h3>Department waiting counts</h3>
                  </div>
                  <span className="live-pill"><span /> LIVE</span>
                </div>

                {departments.map((item) => {
                  const Icon = item.icon;

                  return (
                    <div className="department-row" key={item.code}>
                      <div className="department-icon">
                        <Icon size={20} />
                      </div>
                      <div className="department-info">
                        <strong>{item.name}</strong>
                        <span>Patients waiting in this view</span>
                      </div>
                      <div className="queue-count">
                        {departmentWaitingCounts[item.name] || 0}
                      </div>
                    </div>
                  );
                })}
              </aside>
            </div>
          </>
        ) : (
          <>
            <section className="dashboard-heading">
              <div>
                <div className="eyebrow">
                  <LayoutDashboard size={15} />
                  STAFF CONTROL CENTER
                </div>
                <h1>Queue <span>dashboard</span></h1>
                <p>Manage patient flow across departments.</p>
              </div>
              <div className="dashboard-date">
                {new Date().toLocaleDateString()}
              </div>
            </section>

            <section className="stats-grid">
              <div className="stat-card">
                <Users />
                <span>Total patients</span>
                <strong>{patients.length}</strong>
              </div>
              <div className="stat-card">
                <Clock />
                <span>Waiting now</span>
                <strong>{waitingPatients.length}</strong>
              </div>
              <div className="stat-card">
                <CheckCircle />
                <span>Completed</span>
                <strong>{completedPatients.length}</strong>
              </div>
            </section>

            <section className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <span className="mini-label">PATIENT MANAGEMENT</span>
                  <h3>Current queue</h3>
                </div>

                <button
                  type="button"
                  className="clear-queue-button"
                  onClick={clearPatientQueue}
                  disabled={
                    !staffVerified ||
                    clearingQueue ||
                    queueLoading ||
                    patients.length === 0
                  }
                >
                  <Trash2 size={15} />
                  {clearingQueue ? "Clearing..." : "Clear Queue"}
                </button>
              </div>

              {notice && <div className="notice">{notice}</div>}
              {queueLoading && <p>Loading queue...</p>}
              {queueError && <p role="alert">{queueError}</p>}

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Patient / Token</th>
                      <th>Department</th>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedPatients.map((patient) => (
                      <tr key={patient.id}>
                        <td>
                          <strong>{patient.name}</strong>
                          <span className="token-cell">{patient.token}</span>
                        </td>
                        <td>{patient.department}</td>
                        <td>{patient.time}</td>
                        <td>
                          <span className={"status status-" + patient.status.toLowerCase()}>
                            {patient.status}
                          </span>
                        </td>
                        <td>
                          {patient.status === "Waiting" && (
                            <button
                              type="button"
                              className="small-button"
                              disabled={updatingPatients.includes(patient.id)}
                              onClick={() => updateStatus(patient.id, "Called")}
                            >
                              {updatingPatients.includes(patient.id) ? "Updating..." : "Call"}
                            </button>
                          )}

                          {patient.status === "Called" && (
                            <button
                              type="button"
                              className="small-button complete-button"
                              disabled={updatingPatients.includes(patient.id)}
                              onClick={() => updateStatus(patient.id, "Completed")}
                            >
                              Complete
                            </button>
                          )}

                          {patient.status === "Completed" && "Finished"}
                        </td>
                      </tr>
                    ))}

                    {!queueLoading && !queueError && sortedPatients.length === 0 && (
                      <tr>
                        <td colSpan="5">No patients have registered yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="department-admin-grid">
              {departments.map((item) => {
                const Icon = item.icon;

                const waitingInDepartment = sortedPatients.filter(
                  (patient) =>
                    patient.department === item.name &&
                    patient.status === "Waiting"
                );

                const calledInDepartment = sortedPatients.filter(
                  (patient) =>
                    patient.department === item.name &&
                    patient.status === "Called"
                );

                return (
                  <div className="panel department-admin-card" key={item.code}>
                    <div className="department-icon"><Icon size={22} /></div>
                    <h3>{item.name}</h3>
                    <strong>{waitingInDepartment.length}</strong>
                    <p>patients waiting</p>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => callNext(item.name)}
                      disabled={!staffVerified || waitingInDepartment.length === 0}
                    >
                      Call next patient <ArrowRight size={15} />
                    </button>

                    <div className="department-called-patients">
                      <h4>Patients being treated</h4>

                      {calledInDepartment.length ? (
                        calledInDepartment.map((patient) => (
                          <div className="called-patient-item" key={patient.id}>
                            <div className="called-patient-info">
                              <strong>{patient.name}</strong>
                              <span>{patient.token}</span>
                              <span className="status status-called">Called</span>
                            </div>

                            <button
                              type="button"
                              className="small-button complete-button"
                              disabled={updatingPatients.includes(patient.id)}
                              onClick={() => updateStatus(patient.id, "Completed")}
                            >
                              <CheckCircle size={14} /> Complete
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="no-called-patient">
                          No patients currently being treated.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="staff-logout-section">
              <button
                type="button"
                className="secondary-button"
                onClick={handleStaffLogout}
              >
                Log out
              </button>
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <strong>CareQueue</strong>
        <span>Smart Turn Notification · Healthcare prototype</span>
      </footer>
    </div>
  );
}

export default App;
