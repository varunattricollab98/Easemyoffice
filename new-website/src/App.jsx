import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import VirtualOffice from './pages/VirtualOffice'
import Coworking from './pages/Coworking'
import MeetingRooms from './pages/MeetingRooms'
import CAServices from './pages/CAServices'
import PricingPage from './pages/Pricing'
import About from './pages/About'
import Contact from './pages/Contact'
import CityTemplate from './pages/CityTemplate'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/virtual-office" element={<VirtualOffice />} />
          <Route path="/coworking" element={<Coworking />} />
          <Route path="/meeting-rooms" element={<MeetingRooms />} />
          <Route path="/ca-services" element={<CAServices />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/city/:citySlug" element={<CityTemplate />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

export default App
