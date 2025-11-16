# AURA – Adaptive User Responsive Accessibility

**_"Your web, your way, every day."_**

AURA is a smart browser extension that adapts any webpage to your unique needs. It solves the “one-size-fits-all” problem of the modern web by creating a consistent, customizable, and comfortable browsing experience for everyone — especially individuals with Autism, Dyslexia, sensory sensitivities, or motor/cognitive challenges.

---

## 📊 Project Presentation

For a complete walkthrough of the system architecture, demo, and implementation:

👉 **View the [Project Presentation](https://drive.google.com/file/d/1sFnjhzl_8aRRWmp66Tcbhto8fJn6ueTM/view?usp=sharing) (Team SPARK)**  

---

## 🎯 The Problem

The modern web is still designed for an “average user.” Accessibility tools today are often inconsistent, rigid, and unreliable across different websites. This leaves millions of people with cognitive, visual, sensory, or motor requirements struggling with fragmented support and unnecessary cognitive load.

---

## 💡 Our Solution

AURA transforms the web into a personalized, adaptive environment. It continuously adjusts any webpage in real-time according to each user’s needs—whether cognitive, visual, sensory, or motor—ensuring a seamless, distraction-free, and accessible browsing experience.

---

## ✨ Key Features

### 🔹 User-Based Profiles
Automatically customizes the entire browsing experience based on individual accessibility needs.

### 🔹 Dynamic Rendering
Real-time webpage adjustments, including:
- Font size & type  
- Line spacing  
- High-contrast themes  
- Layout simplification  
- Cursor styles  
- Reduction of visual distractions  

### 🔹 AI-Powered Cognitive Load Reduction
Using the Gemini API for:
- Text simplification  
- Summaries & key point extraction  
- Input correction  
- Content explanation  

### 🔹 Low Vision & Accessibility Enhancements
- Text-to-Speech (TTS)  
- Adjustable voice pitch  
- Smart media summaries  
- Define precise reading start points  

### 🔹 Touchless Gesture Control (trailMotion)
Hands-free browser navigation using:
- OpenCV  
- MediaPipe  
- Custom Gesture Engine  

Perfect for users with motor challenges or touchless interaction needs.

### 🔹 Built-In Ad Blocker
Reduces distractions and cognitive noise for smoother browsing.

---

## 💻 Tech Stack

**Extension**  
- Chrome Manifest V3  
- Content Scripts  
- HTML, CSS  

**AI Backend**  
- Node.js, Express  
- Gemini API  

**Gesture Engine**  
- Python  
- OpenCV  
- MediaPipe  
- WebSockets  

**Storage**  
- Chrome Storage API  

---

## 🚀 How to Run AURA

AURA requires three components running simultaneously:  
➡️ Chrome Extension  
➡️ AI Backend Server (Node.js)  
➡️ Gesture Backend (Python)

---

### 1. AI Backend Server (`aura-server`)

```sh
cd aura-server
npm install
node server.js
````

---

### 2. Gesture Engine Backend (`trialMotion/backend`)

```sh
cd trialMotion/backend
pip install mediapipe opencv-python websockets
python3 main.py
```

Runs on:
`ws://127.0.0.1:8765`

---

### 3. AURA Chrome Extension (Root Folder)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the folder: `Aura_UserLens-main/`
5. Extension activates: **AURA — Accessibility Profiles + Ad Blocker**

---

## 🔭 Future Scope

### 🚀 System-Wide Integration

Extend accessibility features beyond the browser to OS-level controls.

### 😊 Emotion-Adaptive Interface

Auto-adjust UI based on stress or emotional state detected via camera/microphone.

### 🌐 Multilingual & Regional Support

Real-time translation, regional content adaptation, and local language TTS.

---

### 👥 **Built With ❤️ by Team SPARK**

**Team Members:**

* **G. Pavana Lakshmi** (Team Lead)
* **E. Sahasrika**
* **G. Ritesh Reddy**
* **K. Karthikeya**

---

