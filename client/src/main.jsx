import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './App.jsx'
import HomePage from './pages/Home.jsx'
import MapPage from './pages/Map.jsx'
import ListingPage from './pages/Listing.jsx'
import AuthPage from './pages/Auth.jsx'
import CreateAdPage from './pages/CreateAd.jsx'
import EditAdPage from './pages/EditAd.jsx'
import ProfilePage from './pages/Profile.jsx'
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/EmailActions.jsx'
import { ClaimPage, OwnerCheckDetailPage, OwnerChecksPage } from './pages/OwnerChecks.jsx'
import OwnerQuestionsPage from './pages/OwnerQuestions.jsx'
import NotificationsPage from './pages/Notifications.jsx'
import MatchesPage from './pages/Matches.jsx'
import ReportListingPage from './pages/ReportListing.jsx'
import AdminPage from './pages/Admin.jsx'
import LegalPage from './pages/Legal.jsx'
import PrivacyRequestPage from './pages/PrivacyRequest.jsx'
import { LEGAL_DOCUMENTS } from './legal/documents.js'
import { AuthProvider } from './auth/AuthContext.jsx'
import './styles/global.css'

const rootElement = document.getElementById('root')

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="ads" element={<HomePage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="listing/:id" element={<ListingPage />} />
            <Route path="ads/:id" element={<ListingPage />} />
            <Route path="login" element={<AuthPage mode="login" />} />
            <Route path="register" element={<AuthPage mode="register" />} />
            <Route path="create/:type" element={<CreateAdPage />} />
            <Route path="ads/:id/edit" element={<EditAdPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="verify-email" element={<VerifyEmailPage />} />
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="ads/:id/claim" element={<ClaimPage />} />
            <Route path="owner-checks" element={<OwnerChecksPage />} />
            <Route path="owner-checks/:id" element={<OwnerCheckDetailPage />} />
            <Route path="ads/:id/owner-questions" element={<OwnerQuestionsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="matches" element={<MatchesPage />} />
            <Route path="ads/:id/report" element={<ReportListingPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="privacy" element={<LegalPage document={LEGAL_DOCUMENTS.privacy} />} />
            <Route path="privacy-request" element={<PrivacyRequestPage />} />
            <Route path="terms" element={<LegalPage document={LEGAL_DOCUMENTS.terms} />} />
            <Route path="personal-data-consent" element={<LegalPage document={LEGAL_DOCUMENTS.personalDataConsent} />} />
            <Route path="publication-rules" element={<LegalPage document={LEGAL_DOCUMENTS.publicationRules} />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
