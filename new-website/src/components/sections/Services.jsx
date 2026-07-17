import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import { services } from '../../data/services'

export default function Services() {
  return (
    <section id="services" className="py-20 bg-section-light">
      <div className="container-custom">
        <SectionHeading
          title="Everything Your Business Needs, One Platform"
          subtitle="From virtual addresses to CA services, we provide complete business infrastructure solutions across India."
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {services.map((service, index) => {
            const Icon = service.icon
            return (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-text mb-2">{service.title}</h3>
                <p className="text-sm text-text-light mb-4 leading-relaxed">{service.description}</p>
                <ul className="space-y-2 mb-4">
                  {service.features.map((feature) => (
                    <li key={feature} className="text-xs text-text-light flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0"></span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  to={service.link}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:gap-2 transition-all"
                >
                  Learn More <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
