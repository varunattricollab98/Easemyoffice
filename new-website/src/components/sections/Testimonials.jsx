import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'
import { testimonials } from '../../data/testimonials'

export default function Testimonials() {
  return (
    <section id="testimonials" className="py-20 bg-section-light">
      <div className="container-custom">
        <SectionHeading
          title="What Our Clients Say"
          subtitle="Join 5,000+ businesses that trust EaseMyOffice for their virtual office needs"
        />

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-sm text-text-light leading-relaxed mb-6">
                &ldquo;{testimonial.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">
                    {testimonial.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-text">{testimonial.name}</div>
                  <div className="text-xs text-text-light">{testimonial.title}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
