import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase Web configuration for the El Pacha Firebase project.
const firebaseConfig = {
  apiKey: 'AIzaSyCXT7O87Ii-xMpcpTMUvR6z8AYI0FdJe1Y',
  authDomain: 'el-pacha.firebaseapp.com',
  projectId: 'el-pacha',
  storageBucket: 'el-pacha.firebasestorage.app',
  messagingSenderId: '657395419673',
  appId: '1:657395419673:web:00b0a220fdf7d5a8dcb888',
  measurementId: 'G-KJTCJVW9P1'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
