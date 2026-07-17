import { motion } from 'framer-motion'

const stats = [
  { value: '5,000+', label: 'Businesses Served' },
  { value: '200+', label: 'Premium Addresses' },
  { value: '28', label: 'States Covered' },
  { value: '97%', label: 'Approval Rate' },
  { value: '4.9/5', label: 'Google Rating' },
]

export default function Stats() {
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="text-center p-6 rounded-xl bg-section-light border border-gray-100"
            >
              <div className="text-2xl md:text-3xl font-bold text-primary mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-text-light">
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
