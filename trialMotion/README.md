# 📘 **trailMotion — AI-Powered Touchless Gesture Control**

`trailMotion` is a real-time gesture recognition system that turns **any laptop/desktop screen into a touch-like interface** using only a **webcam**.

It uses:

* **Python backend** (MediaPipe + OpenCV)
* **Browser extension** (Chrome MV3)
* **WebSocket communication**
* **Modular gesture plugins** (scalable to 30+ gestures)

You can scroll, click, swipe, and interact with any webpage **without touching your mouse or trackpad**.

---

# 🚀 **Project Overview**

trailMotion gives users a futuristic, touchless “air gesture” interface.

### **High-Level Flow**

```
User → Webcam → Python Backend → Gesture Engine → Browser Extension → Page Events
```

* Python reads the webcam directly (zero video transfer to browser → low latency)
* MediaPipe extracts hand/finger landmarks
* Gesture Engine analyzes movement and triggers gesture modules
* Browser extension receives gesture events via WebSocket
* DOM actions are injected (scroll, click, swipe, zoom, etc.)

---

# 🎯 **Core Goals**

* ⚡ **Low latency** (15–30 ms)
* 📦 **Modular gesture system**
* 🧩 **Backend plugin architecture**
* 🧱 **Frontend plugin architecture**
* 🔌 **Easy to extend to 30+ gestures**
* 🛠️ **AI-friendly code generation**
* 🧪 **Testable + scalable design**
* 🖥️ **Cross-browser and cross-OS compatible**

---

# 🧬 **System Architecture**

## **1. Python Backend**

Handles:

* Webcam capture via OpenCV
* MediaPipe hand tracking
* Gesture recognition
* Sending JSON gesture events to browser

```
camera.py → hand_tracker.py → gesture_engine.py → event_sender.py → browser
```

## **2. Browser Extension (Chrome MV3)**

Handles:

* UI toggles (ON/OFF)
* WebSocket connection
* Injecting DOM interactions
* Mapping backend events → actual browser actions

```
websocket.js → dispatcher.js → gestures/* → content_script.js
```

---

# 🗂️ **Folder Structure**

```
trailMotion/
│
├── backend/
│   ├── core/
│   │   ├── camera.py
│   │   ├── hand_tracker.py
│   │   ├── gesture_engine.py
│   │   ├── event_sender.py
│   │   ├── state_manager.py
│   │   ├── utils.py
│   │   └── config.py
│   │
│   ├── gestures/
│   │   ├── scroll/
│   │   │   ├── scroll.py
│   │   │   └── config.json
│   │   ├── swipe/
│   │   │   ├── swipe.py
│   │   │   └── config.json
│   │   ├── pinch_click/
│   │   │   ├── pinch_click.py
│   │   │   └── config.json
│   │   └── (add unlimited gesture modules)
│   │
│   ├── server/
│   │   ├── ws_server.py
│   │   └── routes.py
│   │
│   ├── tests/
│   │   ├── test_hand_tracker.py
│   │   ├── test_scroll.py
│   │   └── test_gesture_engine.py
│   │
│   └── main.py
│
│
├── extension/
│   ├── manifest.json
│   │
│   ├── background/
│   │   ├── background.js
│   │   └── ws_handler.js
│   │
│   ├── content/
│   │   ├── content_script.js
│   │   └── dom_utils.js
│   │
│   ├── core/
│   │   ├── dispatcher.js
│   │   ├── websocket.js
│   │   ├── state.js
│   │   ├── config.js
│   │   └── logger.js
│   │
│   ├── gestures/
│   │   ├── scroll.js
│   │   ├── click.js
│   │   └── swipe.js
│   │
│   ├── ui/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   ├── styles.css
│   │   └── icons/
│   │       ├── on.png
│   │       └── off.png
│   │
│   └── assets/
│       └── logo.png
│
└── README.md
```

---

# 🧠 **Gesture Engine (Backend)**

### How it works:

* Each gesture module is placed inside `backend/gestures/<gesture_name>/`
* Each module has:

  * `gesture_name.py` → logic
  * `config.json` → thresholds, sensitivity

Each module exposes a class:

```python
class Gesture:
    def process(self, landmarks):
         # return event dict or None
```

The engine auto-loads all gestures, so adding new ones needs **no modification** to core code.

---

# 💡 **Gesture System (Frontend)**

The browser receives events like:

```json
{
  "event": "scroll",
  "data": { "amount": -40 }
}
```

Then:

* `dispatcher.js` routes to `/gestures/scroll.js`
* That file performs actual scroll logic

Adding a new gesture = drop a new JS file into `/gestures/`.

---

# 🔌 **Backend ↔ Browser Communication**

### WebSocket Protocol

Backend sends compact messages:

Example scroll event:

```json
{
  "event": "scroll",
  "data": { "amount": 30 }
}
```

Example click event:

```json
{
  "event": "click"
}
```

Browser extension:

* receives event
* dispatches to correct handler
* injects DOM events

---

# 🧪 **Testing Strategy**

Backend has unit tests for:

* Hand tracker (init + basic behavior)
* Gesture engine (module loading)
* Individual gesture modules
* Possibly integration tests for logic-only components

Frontend is modular and can be tested via:

* Chrome extension test runner
* Jest (optional)
* Manual browser testing

---

# ⚙️ **How to Run (Backend)**

### Install dependencies

```
pip install mediapipe opencv-python websockets fastapi uvicorn
```

### Start backend

```
python3 backend/main.py
```

Backend runs WebSocket on:

```
ws://127.0.0.1:8765
```

---

# 🌐 **How to Run (Browser Extension)**

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load Unpacked**
4. Select `trailMotion/extension/`
5. Open extension popup and toggle **ON**

---

# 🛠️ **How to Add a New Gesture (Backend)**

Example: New gesture named `zoom`

```
backend/gestures/zoom/
    ├── zoom.py
    └── config.json
```

Code auto-loads.

---

# 🛠️ **How to Add a New Gesture (Frontend)**

Example: New JS gesture named `zoom`

```
extension/gestures/zoom.js
```

Dispatcher auto-recognizes and routes.

---
