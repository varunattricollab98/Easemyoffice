import React from 'react'
import { Link } from 'react-router-dom'
import { 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  Facebook, 
  Twitter, 
  Linkedin, 
  Instagram,
  ArrowRight,
  CheckCircle,
  Shield,
  Globe,
  Award
} from 'lucide-react'

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear()

  const solutions = [
    { name: 'Virtual Office', path: '/virtual-office' },
    { name: 'Coworking Space', path: '/coworking' },
    { name: 'Meeting Rooms', path: '/meeting-rooms' },
    { name: 'Company Registration', path: '/services/company-registration' },
    { name: 'GST Registration', path: '/services/gst-registration' },
    { name: 'Business Compliance', path: '/services/compliance' },
  ]

  const locations = [
    { name: 'Bangalore', path: '/locations/bangalore' },
    { name: 'Delhi', path: '/locations/delhi' },
    { name: 'Mumbai', path: '/locations/mumbai' },
    { name: 'Chennai', path: '/locations/chennai' },
    { name: 'Hyderabad', path: '/locations/hyderabad' },
    { name: 'Noida', path: '/locations/noida' },
    { name: 'Gurgaon', path: '/locations/gurgaon' },
    { name: 'Kolkata', path: '/locations/kolkata' },
  ]

  const company = [
    { name: 'About Us', path: '/about' },
    { name: 'Careers', path: '/careers' },
    { name: 'Blog', path: '/blog' },
    { name: 'FAQs', path: '/faqs' },
    { name: 'Contact Us', path: '/contact' },
    { name: 'Privacy Policy', path: '/privacy' },
  ]

  const trustBadges = [
    { icon: <Shield className="w-5 h-5" />, text: 'ISO Certified' },
    { icon: <Award className="w-5 h-5" />, text: 'Award Winning' },
    { icon: <CheckCircle className="w-5 h-5" />, text: 'Verified Reviews' },
    { icon: <Globe className="w-5 h-5" />, text: 'Pan-India Presence' },
  ]

  return (
    <footer className="bg-gradient-to-b from-gray-900 to-gray-950 text-white">
      {/* Main Footer */}
      <div className="container-custom pt-16 pb-12">
        <div className="grid lg:grid-cols-5 gap-12">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-bold">
                  EaseMy<span className="text-primary-300">Office</span>
                </h2>
                <p className="text-gray-400 text-sm">Premium Workspace Solutions</p>
              </div>
            </div>
            
            <p className="text-gray-400 mb-6">
              India's leading platform for virtual offices, coworking spaces, company 
              registration, and business compliance services. Trusted by 5,000+ brands.
            </p>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              {trustBadges.map((badge, index) => (
                <div key={index} className="flex items-center space-x-2 text-gray-300">
                  <div className="text-primary-400">
                    {badge.icon}
                  </div>
                  <span className="text-sm">{badge.text}</span>
                </div>
              ))}
            </div>

            {/* Contact Info */}
            <div className="space-y-4">
              <div className="flex items-center space-x-3 text-gray-300">
                <Phone className="w-5 h-5 text-primary-400" />
                <span>888-273-5038</span>
              </div>
              <div className="flex items-center space-x-3 text-gray-300">
                <Mail className="w-5 h-5 text-primary-400" />
                <span>info@easemyoffice.in</span>
              </div>
              <div className="flex items-start space-x-3 text-gray-300">
                <MapPin className="w-5 h-5 text-primary-400 mt-1" />
                <span>336, Udyog Vihar Phase 4, Sector 19, Gurugram, Haryana 122016</span>
              </div>
            </div>
          </div>

          {/* Solutions */}
          <div>
            <h3 className="text-lg font-semibold mb-6">Solutions</h3>
            <ul className="space-y-3">
              {solutions.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.path}
                    className="text-gray-400 hover:text-white hover:translate-x-1 transition-all duration-200 flex items-center group"
                  >
                    <ArrowRight className="w-3 h-3 mr-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Locations */}
          <div>
            <h3 className="text-lg font-semibold mb-6">Locations</h3>
            <ul className="space-y-3">
              {locations.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.path}
                    className="text-gray-400 hover:text-white hover:translate-x-1 transition-all duration-200 flex items-center group"
                  >
                    <ArrowRight className="w-3 h-3 mr-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-lg font-semibold mb-6">Company</h3>
            <ul className="space-y-3">
              {company.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.path}
                    className="text-gray-400 hover:text-white hover:translate-x-1 transition-all duration-200 flex items-center group"
                  >
                    <ArrowRight className="w-3 h-3 mr-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Newsletter */}
        <div className="mt-12 pt-12 border-t border-gray-800">
          <div className="grid lg:grid-cols-3 gap-8 items-center">
            <div>
              <h3 className="text-xl font-bold mb-2">Stay Updated</h3>
              <p className="text-gray-400">
                Subscribe to our newsletter for workspace insights and offers.
              </p>
            </div>
            <div className="lg:col-span-2">
              <form className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  placeholder="Enter your email address"
                  className="flex-grow px-4 py-3 rounded-lg bg-gray-800 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 border border-gray-700"
                />
                <button
                  type="submit"
                  className="btn-primary px-8 py-3 rounded-lg whitespace-nowrap"
                >
                  Subscribe
                </button>
              </form>
              <p className="text-gray-500 text-sm mt-3">
                By subscribing, you agree to our Privacy Policy
              </p>
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="mt-8 pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center space-x-6">
              {[
                { icon: <Facebook className="w-5 h-5" />, label: 'Facebook' },
                { icon: <Twitter className="w-5 h-5" />, label: 'Twitter' },
                { icon: <Linkedin className="w-5 h-5" />, label: 'LinkedIn' },
                { icon: <Instagram className="w-5 h-5" />, label: 'Instagram' },
              ].map((social) => (
                <a
                  key={social.label}
                  href={`https://${social.label.toLowerCase()}.com/easemyoffice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors flex items-center space-x-2"
                  aria-label={social.label}
                >
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-700 transition-colors">
                    {social.icon}
                  </div>
                  <span className="hidden md:inline">{social.label}</span>
                </a>
              ))}
            </div>

            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                  <span className="font-bold">UPI</span>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Payment Methods</div>
                  <div className="font-medium">All Major Cards & UPI</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                  <span className="font-bold">SSL</span>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Security</div>
                  <div className="font-medium">256-bit SSL Encrypted</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-black/50 py-6">
        <div className="container-custom">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-gray-500 text-sm">
              © {currentYear} EaseMyOffice. All rights reserved.
            </div>
            
            <div className="flex items-center space-x-6 text-gray-500 text-sm">
              <Link to="/terms" className="hover:text-gray-300 transition-colors">
                Terms of Service
              </Link>
              <Link to="/privacy" className="hover:text-gray-300 transition-colors">
                Privacy Policy
              </Link>
              <Link to="/cookies" className="hover:text-gray-300 transition-colors">
                Cookie Policy
              </Link>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span>ISO 27001 Certified</span>
              </div>
            </div>
          </div>

          {/* Back to Top */}
          <div className="mt-6 text-center">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-gray-400 hover:text-white transition-colors text-sm flex items-center justify-center mx-auto space-x-2"
            >
              <ArrowRight className="w-4 h-4 rotate-90" />
              <span>Back to Top</span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer