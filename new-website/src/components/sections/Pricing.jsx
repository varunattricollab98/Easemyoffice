import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'
import Button from '../ui/Button'

const plans = [
  {
    name: 'Mailing Address',
    price: '699',
    period: '/mo',
    description: 'Basic business address for correspondence',
    popular: false,
    features: [
      { text: 'Premium business address', included: true },
      { text: 'Mail handling & forwarding', included: true },
      { text: 'Digital mail notifications', included: true },
      { text: 'Business address proof letter', included: true },
      { text: 'GST registration documents', included: false },
      { text: 'Company registration support', included: false },
      { text: 'Dedicated account manager', included: false },
    ],
  },
  {
    name: 'GST Registration Plan',
    price: '899',
    period: '/mo',
    description: 'Complete GST registration package',
    popular: true,
    features: [
      { text: 'Premium business address', included: true },
      { text: 'Mail handling & forwarding', included: true },
      { text: 'Digital mail notifications', included: true },
      { text: 'Business address proof letter', included: true },
      { text: 'GST registration documents', included: true },
      { text: 'Rent agreement + NOC', included: true },
      { text: 'Dedicated account manager', included: false },
    ],
  },
  {
    name: 'Company Registration Plan',
    price: '1,199',
    period: '/mo',
    description: 'Premium package for company incorporation',
    popular: false,
    features: [
      { text: 'Premium business address', included: true },
      { text: 'Mail handling & forwarding', included: true },
      { text: 'Digital mail notifications', included: true },
      { text: 'Business address proof letter', included: true },
      { text: 'GST registration documents', included: true },
      { text: 'Rent agreement + NOC', included: true },
      { text: 'Dedicated account manager', included: true },
    ],
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-20 bg-white">
      <div className="container-custom">
        <SectionHeading
          title="Simple, Transparent Pricing"
          subtitle="Choose the plan that fits your business needs. No hidden charges, no surprises."
        />

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`relative rounded-2xl p-6 lg:p-8 border-2 transition-all duration-300 hover:shadow-xl ${
                plan.popular
                  ? 'border-primary bg-primary/[0.02] shadow-lg scale-[1.02]'
                  : 'border-gray-100 bg-white hover:-translate-y-1'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white text-xs font-bold px-4 py-1 rounded-full">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className="text-lg font-bold text-text mb-1">{plan.name}</h3>
                <p className="text-sm text-text-light mb-4">{plan.description}</p>
                <div className="flex items-baseline justify-center">
                  <span className="text-lg text-text-light">&#8377;</span>
                  <span className="text-4xl font-bold text-text">{plan.price}</span>
                  <span className="text-text-light ml-1">{plan.period}</span>
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature.text} className="flex items-center gap-3">
                    {feature.included ? (
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-accent-green" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <X className="w-3 h-3 text-gray-400" />
                      </div>
                    )}
                    <span className={`text-sm ${feature.included ? 'text-text' : 'text-text-light'}`}>
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                href="#"
                variant={plan.popular ? 'primary' : 'secondary'}
                className="w-full"
              >
                Get Started
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
