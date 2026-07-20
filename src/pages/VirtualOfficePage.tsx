import React from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, ArrowRight } from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import PageWrapper from '../components/PageWrapper'
import HeroSection from '../components/HeroSection'
import TestimonialsSection from '../components/TestimonialsSection'
import ContactSection from '../components/ContactSection'

interface Plan {
  name: string
  description: string
  features: string[]
  popular?: boolean
}

const plans: Plan[] = [
  {
    name: 'Company Registration Plan',
    description: 'Register your company at premium addresses in any city — without taking a physical office.',
    features: [
      'Register a new business entity at this address',
      'Use this address for GST registration & APOB',
      'NOC, rent agreement & utility bill',
      'MCA registration and compliance support',
      'Use for bank account opening',
      'Mailing & courier handling',
    ],
  },
  {
    name: 'GST Registration Plan',
    description: 'Get a GST-compliant virtual office in any state in India to expand sales pan-India.',
    features: [
      'Use for new GST registration & APOB',
      'Update your existing GST address',
      'GST-ready compliance documents',
      'Business signage at the address',
      'Inspection support',
      'Mailing & courier handling',
    ],
    popular: true,
  },
  {
    name: 'Business Mailing Address',
    description: 'A premium mailing address for your business — no physical office required.',
    features: [
      'Receive business mail & couriers',
      'Mail forwarding (optional)',
      'Use address on website, cards & invoices',
    ],
  },
]

const PricingSection: React.FC = () => {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 })

  return (
    <section ref={ref} className="section-padding bg-gradient-to-b from-white to-gray-50">
      <div className="container-custom">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center space-x-2 bg-primary-50 text-primary-700 px-4 py-2 rounded-full mb-4">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-semibold">Flexible Plans</span>
          </div>
          <h2 className="section-title mb-4">Plans Designed for Your Business</h2>
          <p className="section-subtitle">
            Flexible, affordable plans designed to help your business grow — pick what fits.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: index * 0.15 }}
              className={`relative rounded-2xl border p-8 transition-all duration-300 ${
                plan.popular
                  ? 'border-primary-300 shadow-highlight bg-white scale-[1.02]'
                  : 'border-gray-200 shadow-soft bg-white hover:shadow-elegant'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <div className="badge-premium px-4 py-1.5 text-xs">Most Popular</div>
                </div>
              )}
              <h3 className="text-xl font-bold text-gray-900 mb-3">{plan.name}</h3>
              <p className="text-gray-600 mb-6">{plan.description}</p>
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <button className={plan.popular ? 'btn-primary w-full' : 'btn-secondary w-full'}>
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

const VirtualOfficePage: React.FC = () => {
  return (
    <PageWrapper>
      <HeroSection variant="virtual-office" />
      <PricingSection />
      <TestimonialsSection />
      <ContactSection />
    </PageWrapper>
  )
}

export default VirtualOfficePage