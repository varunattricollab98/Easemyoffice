import { motion } from 'framer-motion'

const logos = [
  'Verizon', 'Kinetic Green', 'Simpl', 'HomeLane', 'Omnicuris',
  'BatterySmart', 'Uptodd', 'Tummy Friendly', 'EarthtronEV', 'Roarx',
  'Fitelo', 'Kalki Fashion', 'Bizz', 'Tuckit', 'Rudra Gas', 'DS Pipeline',
]

export default function TrustLogos() {
  return (
    <section className="py-8 bg-section-light border-y border-gray-100 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <p className="text-center text-xs font-semibold text-text-light uppercase tracking-wider mb-6">
          Trusted by leading companies across India
        </p>
        <div className="relative">
          {/* Gradient fade edges */}
          <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-section-light to-transparent z-10"></div>
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-section-light to-transparent z-10"></div>

          {/* Scrolling container */}
          <div className="flex animate-scroll">
            {[...logos, ...logos].map((logo, index) => (
              <div
                key={`${logo}-${index}`}
                className="flex-shrink-0 px-8 flex items-center justify-center"
              >
                <span className={`text-lg font-${index % 3 === 0 ? 'bold' : index % 3 === 1 ? 'semibold' : 'medium'} text-gray-400 whitespace-nowrap select-none`}>
                  {logo}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
