import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  Phone, 
  Mail, 
  MapPin, 
  Clock, 
  Send,
  CheckCircle,
  Building2,
  Users
} from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'

interface ContactFormData {
  name: string
  email: string
  phone: string
  company: string
  service: string
  message: string
}

const ContactSection: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>()

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true)
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      toast.success('Thank you! Our team will contact you within 30 minutes.', {
        duration: 5000,
        icon: '🎉',
      })
      reset()
    } catch (error) {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const contactInfo = [
    {
      icon: <Phone className="w-6 h-6" />,
      title: 'Call Us',
      details: ['888-273-5038', 'Available 24/7'],
      action: () => window.open('tel:8882735038'),
    },
    {
      icon: <Mail className="w-6 h-6" />,
      title: 'Email Us',
      details: ['info@easemyoffice.in', 'support@easemyoffice.in'],
      action: () => window.open('mailto:info@easemyoffice.in'),
    },
    {
      icon: <MapPin className="w-6 h-6" />,
      title: 'Visit Us',
      details: ['336, Udyog Vihar Phase 4', 'Gurugram, Haryana 122016'],
      action: () => window.open('https://maps.google.com/?q=336+Udyog+Vihar+Phase+4+Gurugram'),
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: 'Business Hours',
      details: ['Mon-Fri: 9 AM - 7 PM', 'Sat: 10 AM - 5 PM'],
      action: null,
    },
  ]

  const services = [
    'Virtual Office',
    'Company Registration',
    'Coworking Space',
    'GST Registration',
    'Meeting Rooms',
    'Compliance Services',
    'Business Address',
    'Other Services',
  ]

  return (
    <section ref={ref} className="section-padding bg-gradient-to-b from-white to-gray-50">
      <div className="container-custom">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center space-x-2 bg-primary-50 text-primary-700 px-4 py-2 rounded-full mb-4">
            <Send className="w-4 h-4" />
            <span className="text-sm font-semibold">Get in Touch</span>
          </div>
          <h2 className="section-title mb-4">
            Let's Transform Your Workspace
          </h2>
          <p className="section-subtitle">
            Schedule a free consultation with our experts and discover the perfect 
            workspace solution for your business needs.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8"
          >
            {/* Contact Cards */}
            <div className="grid sm:grid-cols-2 gap-6">
              {contactInfo.map((info, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                  className={`testimonial-card cursor-pointer ${info.action ? 'hover:shadow-elegant hover:-translate-y-1' : ''}`}
                  onClick={() => info.action?.()}
                >
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                        <div className="text-white">
                          {info.icon}
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        {info.title}
                      </h3>
                      {info.details.map((detail, idx) => (
                        <p key={idx} className="text-gray-600">
                          {detail}
                        </p>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Why Choose Us */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-2xl p-8"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-6">
                Why Contact Us Today?
              </h3>
              <div className="space-y-4">
                {[
                  'Free consultation with workspace experts',
                  'Customized solutions for your business',
                  'Quick response within 30 minutes',
                  'No commitment, no hidden fees',
                  'Flexible payment options',
                  'Dedicated account manager',
                ].map((benefit, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span className="text-gray-700">{benefit}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Live Support */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="bg-white rounded-2xl shadow-elegant p-6 border border-gray-100"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">
                    Need Immediate Assistance?
                  </h4>
                  <p className="text-gray-600 text-sm">
                    Our support team is available 24/7
                  </p>
                </div>
                <button
                  onClick={() => window.open('tel:8882735038')}
                  className="btn-primary px-6 py-3"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call Now
                </button>
              </div>
            </motion.div>
          </motion.div>

          {/* Contact Form */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="bg-white rounded-2xl shadow-elegant p-8 border border-gray-100"
          >
            <div className="flex items-center space-x-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  Book Free Consultation
                </h3>
                <p className="text-gray-600">
                  Fill in your requirements. Our experts will reach out within 30 minutes.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    {...register('name', { required: 'Name is required' })}
                    className="input-field"
                    placeholder="Enter your name"
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    {...register('email', { 
                      required: 'Email is required',
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: 'Invalid email address'
                      }
                    })}
                    className="input-field"
                    placeholder="Enter your email"
                  />
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    {...register('phone', { 
                      required: 'Phone number is required',
                      pattern: {
                        value: /^[0-9]{10}$/,
                        message: 'Enter a valid 10-digit phone number'
                      }
                    })}
                    className="input-field"
                    placeholder="Enter your phone number"
                  />
                  {errors.phone && (
                    <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    {...register('company')}
                    className="input-field"
                    placeholder="Enter company name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Service Interested In *
                </label>
                <select
                  {...register('service', { required: 'Please select a service' })}
                  className="input-field"
                >
                  <option value="">Select a service</option>
                  {services.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
                {errors.service && (
                  <p className="mt-1 text-sm text-red-600">{errors.service.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message
                </label>
                <textarea
                  {...register('message')}
                  rows={4}
                  className="input-field"
                  placeholder="Tell us about your requirements..."
                />
              </div>

              {/* Privacy Policy */}
              <div className="flex items-start space-x-3">
                <div className="flex items-center h-5">
                  <input
                    type="checkbox"
                    required
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                </div>
                <div className="text-sm text-gray-600">
                  I agree to the{' '}
                  <a href="/privacy" className="text-primary-600 hover:text-primary-700 font-medium">
                    Privacy Policy
                  </a>{' '}
                  and consent to being contacted by EaseMyOffice.
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full btn-primary py-4 text-lg"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    <Send className="w-5 h-5 mr-2" />
                    Submit Request
                  </span>
                )}
              </button>

              <div className="text-center">
                <p className="text-sm text-gray-500">
                  We respect your privacy. Your information is secure with us.
                </p>
              </div>
            </form>
          </motion.div>
        </div>

        {/* Location Map Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 1 }}
          className="mt-16"
        >
          <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  Our Office Locations
                </h3>
                <p className="text-gray-600">
                  Visit us at our headquarters or explore our network across India
                </p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5 text-primary-600" />
                  <span className="font-semibold text-gray-900">30+ Cities</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Building2 className="w-5 h-5 text-primary-600" />
                  <span className="font-semibold text-gray-900">200+ Locations</span>
                </div>
              </div>
            </div>

            {/* Map Placeholder */}
            <div className="bg-white rounded-xl p-6 shadow-soft">
              <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-12 h-12 text-primary-600 mx-auto mb-4" />
                  <p className="text-gray-700 font-medium">
                    Interactive Map Coming Soon
                  </p>
                  <p className="text-gray-600 text-sm mt-2">
                    Explore our locations across India
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

export default ContactSection