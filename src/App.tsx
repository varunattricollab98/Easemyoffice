import React, { useEffect, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import VirtualOfficePage from './pages/VirtualOfficePage'
import CoworkingPage from './pages/CoworkingPage'
import ServicesPage from './pages/ServicesPage'
import ContactPage from './pages/ContactPage'
import LoadingScreen from './components/LoadingScreen'
import ScrollToTop from './components/ScrollToTop'

function App() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading for better UX
    const timer = setTimeout(() => {
      setLoading(false)
    }, 1500)

    return () => clearTimeout(timer)
  }, [])

  // Preload critical images
  useEffect(() => {
    const preloadImages = [
      '/images/hero-bg.jpg',
      '/images/office-space-1.jpg',
      '/images/office-space-2.jpg',
      '/images/virtual-office-hero.jpg',
    ]

    preloadImages.forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [])

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow">
        <ScrollToTop />
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<HomePage />} />
            <Route path="/virtual-office" element={<VirtualOfficePage />} />
            <Route path="/coworking" element={<CoworkingPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/contact" element={<ContactPage />} />
          </Routes>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  )
}

export default App