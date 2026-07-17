import { motion } from 'framer-motion'

export default function SectionHeading({ title, subtitle, centered = true, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5 }}
      className={`mb-12 ${centered ? 'text-center' : ''} ${className}`}
    >
      <h2 className="text-3xl md:text-4xl font-bold text-text mb-4">
        {title}
      </h2>
      {subtitle && (
        <p className="text-text-light text-lg max-w-2xl mx-auto">
          {subtitle}
        </p>
      )}
    </motion.div>
  )
}
