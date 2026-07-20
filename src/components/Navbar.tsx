import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Building2, 
  MapPin, 
  Phone, 
  Menu, 
  X, 
  ChevronDown,
  CheckCircle,
  Globe,
  Users
} from 'lucide-react'
import toast from 'react-hot-toast'

const Navbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const location = useLocation()

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    {
      name: 'Solutions',
      path: '/solutions',
      dropdown: [
        { name: 'Virtual Office', path: '/virtual-office', icon: <Building2 className="w-4 h-4" /> },
        { name: 'Coworking Space', path: '/coworking', icon: <Users className="w-4 h-4" /> },
        { name: 'Meeting Rooms', path: '/meeting-rooms', icon: <Building2 className="w-4 h-4" /> },
      ]
    },
    {
      name: 'Locations',
      path: '/locations',
      dropdown: [
        { name: 'Bangalore', path: '/locations/bangalore', icon: <MapPin className="w-4 h-4" /> },
        { name: 'Delhi', path: '/locations/delhi', icon: <MapPin className="w-4 h-4" /> },
        { name: 'Mumbai', path: '/locations/mumbai', icon: <MapPin className="w-4 h-4" /> },
        { name: 'Chennai', path: '/locations/chennai', icon: <MapPin className="w-4 h-4" /> },
        { name: 'Hyderabad', path: '/locations/hyderabad', icon: <MapPin className="w-4 h-4" /> },
        { name: 'Noida', path: '/locations/noida', icon: <MapPin className="w-4 h-4" /> },
      ]
    },
    {
      name: 'Services',
      path: '/services',
      dropdown: [
        { name: 'Company Registration', path: '/services/company-registration', icon: <CheckCircle className="w-4 h-4" /> },
        { name: 'GST Registration', path: '/services/gst-registration', icon: <CheckCircle className="w-4 h-4" /> },
        { name: 'Trademark Registration', path: '/services/trademark', icon: <CheckCircle className="w-4 h-4" /> },
        { name: 'Compliance Services', path: '/services/compliance', icon: <CheckCircle className="w-4 h-4" /> },
      ]
    },
    { name: 'About', path: '/about' },
    { name: 'Contact', path: '/contact' },
  ]

  const handleCallClick = () => {
    toast.success('Calling our expert team...', {
      icon: '📞',
      duration: 3000,
    })
    // In production, this would trigger a phone call
    window.open('tel:8882735038')
  }

  const handleConsultationClick = () => {
    toast.success('Redirecting to consultation form...', {
      icon: '📋',
      duration: 3000,
    })
  }

  return (
    <>
      {/* Top Announcement Bar */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-800 text-white py-2">
        <div className="container-custom">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4" />
                <span>30+ Cities Across India</span>
              </div>
              <div className="hidden md:flex items-center space-x-2">
                <CheckCircle className="w-4 h-4" />
                <span>Trusted by 5,000+ Businesses</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <a 
                href="mailto:info@easemyoffice.in" 
                className="hover:text-primary-100 transition-colors"
              >
                info@easemyoffice.in
              </a>
              <button 
                onClick={handleCallClick}
                className="flex items-center space-x-2 hover:text-primary-100 transition-colors"
              >
                <Phone className="w-4 h-4" />
                <span>888-273-5038</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <nav className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass-effect shadow-elegant' : 'bg-white'
      }`}>
        <div className="container-custom py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link 
              to="/" 
              className="flex items-center space-x-3 group"
            >
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl"
              >
                <Building2 className="w-7 h-7 text-white" />
              </motion.div>
              <div>
                <h1 className="text-2xl font-display font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                  EaseMy<span className="gradient-text">Office</span>
                </h1>
                <p className="text-xs text-gray-500 font-medium">Premium Workspace Solutions</p>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center space-x-8">
              {navItems.map((item) => (
                <div 
                  key={item.name}
                  className="relative"
                  onMouseEnter={() => item.dropdown && setActiveDropdown(item.name)}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <Link
                    to={item.path}
                    className={`nav-link ${
                      location.pathname === item.path ? 'nav-link-active' : ''
                    } flex items-center space-x-1`}
                  >
                    <span>{item.name}</span>
                    {item.dropdown && (
                      <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${
                        activeDropdown === item.name ? 'rotate-180' : ''
                      }`} />
                    )}
                  </Link>

                  {/* Dropdown Menu */}
                  <AnimatePresence>
                    {item.dropdown && activeDropdown === item.name && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full left-0 mt-2 w-64 bg-white rounded-2xl shadow-elegant border border-gray-100 overflow-hidden"
                      >
                        {item.dropdown.map((subItem) => (
                          <Link
                            key={subItem.name}
                            to={subItem.path}
                            className="flex items-center space-x-3 px-4 py-3 hover:bg-primary-50 transition-colors group"
                            onClick={() => setActiveDropdown(null)}
                          >
                            <div className="text-primary-600 group-hover:text-primary-700">
                              {subItem.icon}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 group-hover:text-primary-700">
                                {subItem.name}
                              </div>
                              <div className="text-xs text-gray-500">
                                Premium solutions available
                              </div>
                            </div>
                          </Link>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}

              {/* CTA Buttons */}
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleCallClick}
                  className="btn-outline flex items-center space-x-2"
                >
                  <Phone className="w-4 h-4" />
                  <span>Call Now</span>
                </button>
                <Link
                  to="/contact"
                  onClick={handleConsultationClick}
                  className="btn-primary"
                >
                  Book Free Consultation
                </Link>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Toggle menu"
            >
              {isOpen ? (
                <X className="w-6 h-6 text-gray-700" />
              ) : (
                <Menu className="w-6 h-6 text-gray-700" />
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:hidden mt-4 overflow-hidden"
              >
                <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
                  {navItems.map((item) => (
                    <div key={item.name}>
                      <Link
                        to={item.path}
                        className={`block px-4 py-3 rounded-lg font-medium ${
                          location.pathname === item.path
                            ? 'bg-primary-50 text-primary-700'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                        onClick={() => setIsOpen(false)}
                      >
                        {item.name}
                      </Link>
                      {item.dropdown && (
                        <div className="ml-4 mt-1 space-y-1">
                          {item.dropdown.map((subItem) => (
                            <Link
                              key={subItem.name}
                              to={subItem.path}
                              className="block px-4 py-2 text-sm text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                              onClick={() => setIsOpen(false)}
                            >
                              {subItem.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="pt-4 border-t border-gray-200 space-y-3">
                    <button
                      onClick={() => {
                        handleCallClick()
                        setIsOpen(false)
                      }}
                      className="w-full btn-outline flex items-center justify-center space-x-2"
                    >
                      <Phone className="w-4 h-4" />
                      <span>Call Now: 888-273-5038</span>
                    </button>
                    <Link
                      to="/contact"
                      onClick={() => {
                        handleConsultationClick()
                        setIsOpen(false)
                      }}
                      className="w-full btn-primary flex items-center justify-center"
                    >
                      Book Free Consultation
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>
    </>
  )
}

export default Navbar