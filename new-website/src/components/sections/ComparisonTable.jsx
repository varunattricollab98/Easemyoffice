import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'

const columns = [
  { name: 'EaseMyOffice', highlight: true },
  { name: 'Coworking', highlight: false },
  { name: 'Traditional Office', highlight: false },
]

const rows = [
  {
    label: 'Monthly Cost',
    values: ['Starting ₹699', '₹5,000 - ₹15,000', '₹25,000+'],
  },
  {
    label: 'Setup Time',
    values: ['2-3 Days', '1-2 Weeks', '1-3 Months'],
  },
  {
    label: 'GST Documents',
    values: [true, 'Limited', false],
  },
  {
    label: 'Company Registration',
    values: [true, false, true],
  },
  {
    label: 'Pan-India Presence',
    values: [true, false, false],
  },
  {
    label: 'Mail Handling',
    values: [true, true, true],
  },
  {
    label: 'No Lock-in',
    values: [true, false, false],
  },
  {
    label: 'Dedicated Manager',
    values: [true, false, false],
  },
]

function CellValue({ value }) {
  if (value === true) {
    return (
      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center mx-auto">
        <Check className="w-3.5 h-3.5 text-accent-green" />
      </div>
    )
  }
  if (value === false) {
    return (
      <div className="w-6 h-6 rounded-full bg-red-50 flex items-center justify-center mx-auto">
        <X className="w-3.5 h-3.5 text-red-400" />
      </div>
    )
  }
  return <span className="text-sm">{value}</span>
}

export default function ComparisonTable() {
  return (
    <section className="py-20 bg-section-light">
      <div className="container-custom">
        <SectionHeading
          title="Why EaseMyOffice Over Alternatives?"
          subtitle="See how we compare against traditional options"
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5 }}
          className="max-w-4xl mx-auto overflow-x-auto"
        >
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden min-w-[600px]">
            {/* Header */}
            <div className="grid grid-cols-4 border-b border-gray-100">
              <div className="p-4 lg:p-5"></div>
              {columns.map((col) => (
                <div
                  key={col.name}
                  className={`p-4 lg:p-5 text-center ${
                    col.highlight ? 'bg-primary/5' : ''
                  }`}
                >
                  <span className={`text-sm font-bold ${col.highlight ? 'text-primary' : 'text-text'}`}>
                    {col.name}
                  </span>
                  {col.highlight && (
                    <span className="block text-[10px] font-bold text-primary mt-0.5 uppercase tracking-wider">
                      Best Value
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Rows */}
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={`grid grid-cols-4 ${index !== rows.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="p-4 lg:p-5 flex items-center">
                  <span className="text-sm font-medium text-text">{row.label}</span>
                </div>
                {row.values.map((value, colIndex) => (
                  <div
                    key={colIndex}
                    className={`p-4 lg:p-5 flex items-center justify-center ${
                      colIndex === 0 ? 'bg-primary/5' : ''
                    }`}
                  >
                    <CellValue value={value} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
