import { motion } from 'framer-motion'

export default function Card({ children, className = '', hover = true, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay }}
      className={`bg-white rounded-2xl p-6 ${hover ? 'hover:shadow-xl hover:-translate-y-1 transition-all duration-300' : ''} shadow-md border border-gray-100 ${className}`}
    >
      {children}
    </motion.div>
  )
}
