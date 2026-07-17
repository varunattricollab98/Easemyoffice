import { motion } from 'framer-motion'
import { Building, FileCheck, Zap, UserCheck, DollarSign, Globe } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'

const features = [
  {
    icon: Building,
    title: 'Premium Addresses',
    description: 'Grade-A commercial locations in prime business districts across 200+ locations.',
  },
  {
    icon: FileCheck,
    title: 'GST-Ready Paperwork',
    description: 'Complete documentation package accepted by all government authorities.',
  },
  {
    icon: Zap,
    title: 'Fast Turnaround',
    description: 'Get your business address and all documents within just 2-3 business days.',
  },
  {
    icon: UserCheck,
    title: 'Dedicated Manager',
    description: 'A personal account manager to handle all your queries and documentation needs.',
  },
  {
    icon: DollarSign,
    title: 'Transparent Pricing',
    description: 'No hidden charges, no surprise fees. What you see is what you pay.',
  },
  {
    icon: Globe,
    title: 'Pan-India Coverage',
    description: 'Present in 28 states with 200+ premium addresses to choose from.',
  },
]

export default function WhyChooseUs() {
  return (
    <section className="py-20 bg-white">
      <div className="container-custom">
        <SectionHeading
          title="Why Businesses Choose EaseMyOffice"
          subtitle="We make getting a business address simple, fast, and affordable"
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="flex gap-4 p-5 rounded-xl hover:bg-section-light transition-colors duration-300"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-text mb-1">{feature.title}</h3>
                  <p className="text-sm text-text-light leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
