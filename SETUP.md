# 444Music — Setup & Deployment Guide

## 📁 Project Structure
```
444music/
├── index.html        ← Main app (all pages/UI)
├── style.css         ← Complete stylesheet
├── app.js            ← Full app logic (ES module)
├── sw.js             ← Service worker (PWA/offline)
├── manifest.json     ← PWA manifest
├── icons/            ← App icons (you generate these)
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-192.png
│   └── icon-512.png
└── SETUP.md          ← This file
```

---

## 🔥 Step 1 — Firebase Setup

### Create Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add Project** → name it "444music"
3. Enable Google Analytics (optional)

### Enable Services
In the Firebase console sidebar:

**Authentication:**
- Build → Authentication → Get Started
- Sign-in method → **Email/Password** → Enable

**Firestore Database:**
- Build → Firestore Database → Create database
- Choose **Production mode**
- Pick your nearest region

**Storage:**
- Build → Storage → Get Started
- Start in production mode

### Get Config
- Project Settings (⚙️) → Your apps → Web app (</>)
- Register app, copy the `firebaseConfig` object

### Paste Config in app.js
Find this section in `app.js` and replace:
```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCefqZIewWOTaEnOFWSg-8aBLpu2YKtDy8",
  authDomain: "music-7a35b.firebaseapp.com",
  projectId: "music-7a35b",
  storageBucket: "music-7a35b.appspot.com",
  messagingSenderId: "26882716946",
  appId: "1:26882716946:web:5cc1c9e980bc6597442fcb",
  measurementId: "G-2C0JM7V615"
};

---

## 🔐 Step 2 — Set Up Admin Account

1. Go to your deployed app and **create an account** with your admin email
2. In Firebase Console → Authentication → Users
3. Copy your UID (the long string like `abc123xyz...`)
4. In `app.js`, replace:
```javascript
const ADMIN_UID = "YOUR_ADMIN_UID";
```

---

## 📋 Step 3 — Firestore Security Rules

In Firebase Console → Firestore → Rules, paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Songs — anyone can read, only admin can write
    match /songs/{songId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == "YOUR_ADMIN_UID";
      allow update: if request.auth != null 
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['streams']);
    }

    // Users — own data only
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      match /likes/{likeId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      match /playlists/{playlistId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      match /history/{histId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

---

## 🗄️ Step 4 — Storage Rules

In Firebase Console → Storage → Rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Songs — public read, admin upload only
    match /songs/{fileName} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == "YOUR_ADMIN_UID";
    }

    // Covers — public read, admin upload only
    match /covers/{fileName} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == "YOUR_ADMIN_UID";
    }
  }
}
```

---

## 🌐 Step 5 — Deploy to Vercel

### Option A: Vercel CLI
```bash
npm i -g vercel
cd 444music
vercel --prod
```

### Option B: GitHub + Vercel
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project
3. Connect GitHub repo → Deploy
4. Your app is live at `https://yourproject.vercel.app`

### Option C: Vercel Drag & Drop
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag your `444music/` folder
3. Deploy instantly

---

## 📱 Step 6 — App Icons

Generate icons from your logo at [realfavicongenerator.net](https://realfavicongenerator.net) or [pwabuilder.com](https://pwabuilder.com) and place them in the `icons/` folder.

---

## 📦 Step 7 — APK Conversion (Android)

Use [PWABuilder](https://pwabuilder.com):
1. Enter your app URL
2. Click **Build** → Android
3. Download the APK or AAB

Or use a WebView wrapper:
```xml
<!-- Android WebView activity -->
<activity android:name=".MainActivity">
  <webview android:url="https://yourapp.vercel.app" />
</activity>
```

---

## 🎨 Customization Checklist

- [ ] Replace Firebase config in `app.js`
- [ ] Set your Admin UID in `app.js`
- [ ] Update Firestore & Storage security rules
- [ ] Add app icons to `/icons/`
- [ ] Deploy to Vercel (HTTPS required for PWA)
- [ ] Create admin account and test song upload
- [ ] Test on mobile — install to home screen

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS (ES Modules) |
| Auth | Firebase Authentication |
| Database | Cloud Firestore |
| Storage | Firebase Storage |
| PWA | Web App Manifest + Service Worker |
| Hosting | Vercel |
| APK | PWABuilder / WebView |

---

## ✨ Features Summary

✅ Full music player (play/pause/seek/next/prev)  
✅ Background playback + Media Session API  
✅ Admin-only song uploads  
✅ User auth (email/password)  
✅ Like songs  
✅ Create & manage playlists  
✅ Listening history  
✅ Download songs  
✅ Share songs (Web Share API + copy link)  
✅ Search by title, artist, genre  
✅ Genre filter chips  
✅ Trending algorithm (by stream count)  
✅ Artist profile pages  
✅ Stream count tracking  
✅ PWA (installable on Android & iOS)  
✅ Offline support (service worker caching)  
✅ Keyboard shortcuts (Space, ←, →)  
✅ Responsive / mobile-first  
✅ Dark theme  
✅ Mini player + Full player  
✅ Deep link support (`?song=ID`)  
✅ Admin dashboard with delete  
✅ Duplicate song prevention  
✅ Demo mode (works without Firebase)  
