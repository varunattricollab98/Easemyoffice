import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, Phone } from 'lucide-react'
import Button from '../ui/Button'

const navLinks = [
  { label: 'Services', href: '#services' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Reviews', href: '#testimonials' },
  { label: 'FAQ', href: '#faq' },
]

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 bg-white transition-shadow duration-300 ${
        scrolled ? 'shadow-md' : ''
      }`}
    >
      <div className="container-custom">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-1">
            <span className="text-xl lg:text-2xl font-bold text-text">
              Ease<span className="text-primary">My</span>Office
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-text-light hover:text-primary transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-4">
            <a
              href="tel:+919999999999"
              className="flex items-center gap-2 text-sm font-medium text-text-light hover:text-primary transition-colors"
            >
              <Phone className="w-4 h-4" />
              Talk to Expert
            </a>
            <Button to="/contact" size="sm">
              Get Started
            </Button>
          </div>

          {/* Mobile Toggle */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden p-2 text-text hover:text-primary transition-colors"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="lg:hidden bg-white border-t border-gray-100 shadow-lg">
          <div className="container-custom py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="block py-2 text-sm font-medium text-text-light hover:text-primary transition-colors"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <a
                href="tel:+919999999999"
                className="flex items-center gap-2 py-2 text-sm font-medium text-text-light hover:text-primary transition-colors"
              >
                <Phone className="w-4 h-4" />
                Talk to Expert
              </a>
              <Button to="/contact" size="sm" className="w-full">
                Get Started
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
