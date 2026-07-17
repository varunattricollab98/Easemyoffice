import { motion } from 'framer-motion'
import { Phone } from 'lucide-react'
import Button from '../ui/Button'

export default function FinalCTA() {
  return (
    <section className="py-20 bg-gradient-to-br from-primary to-primary-light relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-72 h-72 bg-white rounded-full -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-white rounded-full translate-x-1/3 translate-y-1/3"></div>
      </div>

      <div className="container-custom relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-2xl mx-auto"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to Get Your Premium Business Address?
          </h2>
          <p className="text-lg text-white/80 mb-8">
            Join 5,000+ businesses that trust EaseMyOffice. Setup takes just 2-3 days with complete documentation support.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Button href="#pricing" variant="white" size="lg">
              Get Started Now
            </Button>
          </div>

          <a
            href="tel:+919999999999"
            className="inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors"
          >
            <Phone className="w-4 h-4" />
            <span className="text-sm font-medium">Or call us: +91 99999 99999</span>
          </a>
        </motion.div>
      </div>
    </section>
  )
}
