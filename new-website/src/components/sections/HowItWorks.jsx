import { motion } from 'framer-motion'
import { ClipboardList, FileText, PenTool, MapPin } from 'lucide-react'
import SectionHeading from '../ui/SectionHeading'

const steps = [
  {
    icon: ClipboardList,
    title: 'Choose Your Plan',
    description: 'Select a plan that suits your business requirements and budget.',
  },
  {
    icon: FileText,
    title: 'Submit KYC Details',
    description: 'Upload your identity and address proof documents securely online.',
  },
  {
    icon: PenTool,
    title: 'Sign Agreement',
    description: 'Review and sign the digital rental agreement with just a few clicks.',
  },
  {
    icon: MapPin,
    title: 'Get Your Address',
    description: 'Receive your premium business address with all supporting documents.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 bg-section-light">
      <div className="container-custom">
        <SectionHeading
          title="Get Started in 4 Simple Steps"
          subtitle="Our streamlined process gets you a premium business address in just 2-3 days"
        />

        <div className="relative max-w-4xl mx-auto">
          {/* Connecting line - desktop */}
          <div className="hidden md:block absolute top-16 left-[calc(12.5%+24px)] right-[calc(12.5%+24px)] h-0.5 bg-primary/20"></div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-4">
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  className="text-center relative"
                >
                  {/* Step number and icon */}
                  <div className="relative inline-flex flex-col items-center">
                    <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-primary/25">
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-6 h-6 bg-white border-2 border-primary rounded-full flex items-center justify-center text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-text mb-2">{step.title}</h3>
                  <p className="text-sm text-text-light leading-relaxed">{step.description}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
