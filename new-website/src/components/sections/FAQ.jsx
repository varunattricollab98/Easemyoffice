import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'
import { faqs } from '../../data/faq'

function FAQItem({ question, answer, isOpen, onClick }) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between p-5 text-left bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-text pr-4">{question}</span>
        <ChevronDown
          className={`w-5 h-5 text-text-light flex-shrink-0 transition-transform duration-300 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="px-5 pb-5 bg-white">
              <p className="text-sm text-text-light leading-relaxed">{answer}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section id="faq" className="py-20 bg-white">
      <div className="container-custom">
        <SectionHeading
          title="Frequently Asked Questions"
          subtitle="Everything you need to know about our virtual office solutions"
        />

        <div className="max-w-3xl mx-auto space-y-3">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <FAQItem
                question={faq.question}
                answer={faq.answer}
                isOpen={openIndex === index}
                onClick={() => setOpenIndex(openIndex === index ? -1 : index)}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
