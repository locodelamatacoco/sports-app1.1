// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
// import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import SportPage from './pages/SportPage';
import ScoresPage from './pages/ScoresPage';
import SocialPage from './pages/SocialPage';
import StandingsPage from './pages/StandingsPage';
import PollsPage from './pages/PollsPage';
import UFCBettingPage from './pages/UFCBettingPage';
import './index.css';

export default function App() {
  return (
    <Router>
      <div className="app-wrapper">
        <Header />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/scores" element={<ScoresPage />} />
            <Route path="/social" element={<SocialPage />} />
            <Route path="/standings" element={<StandingsPage />} />
            <Route path="/polls" element={<PollsPage />} />
            <Route path="/ufc-model" element={<UFCBettingPage />} />
            <Route path="/:sportId" element={<SportPage />} />
            <Route path="/:sportId/:tab" element={<SportPage />} />
          </Routes>
        </main>
        {/* <Footer /> */}
      </div>
    </Router>
  );
}
