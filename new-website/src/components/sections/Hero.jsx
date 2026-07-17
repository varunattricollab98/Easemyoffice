import { motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import Button from '../ui/Button'

const trustPoints = [
  'No hidden charges',
  '97% approval rate',
  '4.9/5 on Google',
]

const cityOptions = [
  'Delhi', 'Mumbai', 'Bangalore', 'Gurgaon', 'Noida', 'Pune',
  'Hyderabad', 'Chennai', 'Ahmedabad', 'Kolkata', 'Jaipur',
  'Chandigarh', 'Lucknow', 'Indore', 'Kochi', 'Bhubaneswar',
]

const serviceOptions = [
  'Virtual Office - Mailing Address',
  'Virtual Office - GST Registration',
  'Virtual Office - Company Registration',
  'Coworking Space',
  'Meeting Room',
  'CA Services',
]

export default function Hero() {
  return (
    <section className="pt-24 lg:pt-32 pb-16 lg:pb-24 bg-white overflow-hidden">
      <div className="container-custom">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-2 mb-6">
              <span className="w-2 h-2 bg-accent-green rounded-full animate-pulse"></span>
              <span className="text-sm font-medium text-green-700">
                Trusted by 5,000+ Businesses Across India
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-bold text-text leading-tight mb-6">
              Your Premium Business Address Starts at{' '}
              <span className="text-primary">&#8377;699/mo</span>
            </h1>

            {/* Subtext */}
            <p className="text-lg text-text-light mb-8 max-w-lg">
              Get a professional business address for GST registration, company incorporation,
              and mailing. Setup in just 2-3 days with complete documentation support.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-4 mb-8">
              <Button href="#pricing" size="lg">
                View Plans
              </Button>
              <Button href="#how-it-works" variant="secondary" size="lg">
                How It Works
              </Button>
            </div>

            {/* Trust Checkmarks */}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {trustPoints.map((point) => (
                <div key={point} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-accent-green" />
                  </div>
                  <span className="text-sm text-text-light">{point}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right - Enquiry Form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 lg:p-8">
              <h3 className="text-xl font-bold text-text mb-2">Get Free Consultation</h3>
              <p className="text-sm text-text-light mb-6">Fill in your details and our expert will call you back</p>

              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div>
                  <input
                    type="text"
                    placeholder="Your Name"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
                <div>
                  <input
                    type="email"
                    placeholder="Email Address"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
                <div>
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
                <div className="relative">
                  <select
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none bg-white text-text-light"
                    defaultValue=""
                  >
                    <option value="" disabled>Select City</option>
                    {cityOptions.map((city) => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none bg-white text-text-light"
                    defaultValue=""
                  >
                    <option value="" disabled>Select Service</option>
                    {serviceOptions.map((service) => (
                      <option key={service} value={service}>{service}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                <Button type="submit" className="w-full" size="lg">
                  Get Free Quote
                </Button>
              </form>

              <p className="text-xs text-text-light text-center mt-4">
                By submitting, you agree to our Terms of Service and Privacy Policy
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
