import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'
import { cities } from '../../data/cities'

export default function CityGrid() {
  return (
    <section className="py-20 bg-white">
      <div className="container-custom">
        <SectionHeading
          title="Available in 200+ Locations Across India"
          subtitle="Get a premium business address in any of these major cities"
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {cities.map((city, index) => (
            <motion.div
              key={city.slug}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.4, delay: index * 0.03 }}
            >
              <Link
                to={`/city/${city.slug}`}
                className="block p-4 rounded-xl border border-gray-100 bg-white hover:border-primary/30 hover:shadow-md hover:bg-primary/[0.02] transition-all duration-300 group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="font-semibold text-text text-sm">{city.name}</span>
                </div>
                <span className="text-xs text-text-light">
                  Starting &#8377;{city.price}/mo
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
