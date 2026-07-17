import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'

const footerLinks = {
  Company: [
    { label: 'About', to: '/about' },
    { label: 'Contact', to: '/contact' },
    { label: 'Careers', to: '#' },
    { label: 'Blog', to: '#' },
  ],
  Services: [
    { label: 'Virtual Office', to: '/virtual-office' },
    { label: 'Coworking', to: '/coworking' },
    { label: 'Meeting Rooms', to: '/meeting-rooms' },
    { label: 'CA Services', to: '/ca-services' },
  ],
  Cities: [
    { label: 'Delhi', to: '/city/delhi' },
    { label: 'Mumbai', to: '/city/mumbai' },
    { label: 'Bangalore', to: '/city/bangalore' },
    { label: 'Gurgaon', to: '/city/gurgaon' },
    { label: 'Noida', to: '/city/noida' },
    { label: 'Pune', to: '/city/pune' },
    { label: 'Hyderabad', to: '/city/hyderabad' },
    { label: 'Chennai', to: '/city/chennai' },
    { label: 'Kolkata', to: '/city/kolkata' },
    { label: '+7 more', to: '#' },
  ],
  Legal: [
    { label: 'Privacy Policy', to: '#' },
    { label: 'Terms of Service', to: '#' },
    { label: 'Refund Policy', to: '#' },
  ],
}

export default function Footer() {
  return (
    <>
      <footer className="bg-gray-900 text-gray-300">
        <div className="container-custom py-16">
          {/* Top Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
              <Link to="/" className="inline-block mb-4">
                <span className="text-xl font-bold text-white">
                  Ease<span className="text-blue-400">My</span>Office
                </span>
              </Link>
              <p className="text-sm text-gray-400 max-w-xs">
                India&#39;s leading virtual office and business address provider. Premium addresses across 28 states.
              </p>
            </div>

            {/* Links */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h4 className="text-white font-semibold mb-4 text-sm">{title}</h4>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom Section */}
          <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} EaseMyOffice. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">
                LinkedIn
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">
                Twitter
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">
                Instagram
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors text-sm">
                Facebook
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* WhatsApp Floating Button */}
      <a
        href="https://wa.me/919999999999"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
        aria-label="Chat on WhatsApp"
      >
        <MessageCircle className="w-6 h-6" />
      </a>
    </>
  )
}
