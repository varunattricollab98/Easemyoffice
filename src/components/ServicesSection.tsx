import React from 'react'
import { motion } from 'framer-motion'
import { 
  Building2, 
  FileText, 
  Users, 
  MapPin, 
  CheckCircle,
  Clock,
  Shield,
  TrendingUp,
  Globe,
  Award,
  Zap,
  Heart
} from 'lucide-react'
import { useInView } from 'react-intersection-observer'

interface Service {
  id: number
  title: string
  description: string
  icon: React.ReactNode
  features: string[]
  gradient: string
  popular?: boolean
}

const ServicesSection: React.FC = () => {
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  })

  const services: Service[] = [
    {
      id: 1,
      title: 'Virtual Office',
      description: 'Get a premium business address for company registration, GST compliance, and mailing services without physical office space.',
      icon: <Building2 className="w-8 h-8" />,
      features: ['Company Registration', 'GST Services', 'Business Address', 'Mail Handling', 'Compliance Support'],
      gradient: 'from-blue-500 to-indigo-600',
      popular: true,
    },
    {
      id: 2,
      title: 'Coworking Spaces',
      description: 'Flexible workspaces with dedicated desks, private cabins, meeting rooms, and modern amenities for teams of all sizes.',
      icon: <Users className="w-8 h-8" />,
      features: ['Dedicated Desks', 'Private Cabins', 'Meeting Rooms', 'High-speed WiFi', '24/7 Access'],
      gradient: 'from-green-500 to-emerald-600',
    },
    {
      id: 3,
      title: 'Company Registration',
      description: 'Complete company registration services with premium addresses, legal compliance, and documentation support.',
      icon: <FileText className="w-8 h-8" />,
      features: ['Private Limited', 'LLP Registration', 'GST Registration', 'ROC Compliance', 'PAN/TAN'],
      gradient: 'from-purple-500 to-pink-600',
    },
    {
      id: 4,
      title: 'Business Compliance',
      description: 'End-to-end compliance services including GST filing, annual returns, tax consultations, and regulatory support.',
      icon: <Shield className="w-8 h-8" />,
      features: ['GST Filing', 'Annual Returns', 'Tax Consultation', 'Audit Support', 'Legal Compliance'],
      gradient: 'from-orange-500 to-red-600',
    },
  ]

  const features = [
    {
      icon: <Globe className="w-6 h-6" />,
      title: 'Pan-India Coverage',
      description: 'Services available in 30+ cities across India',
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: 'Fast Processing',
      description: 'Virtual office setup in 2-3 working days',
    },
    {
      icon: <Award className="w-6 h-6" />,
      title: 'Premium Locations',
      description: 'Business addresses at prime commercial locations',
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: 'Quick Support',
      description: 'Dedicated relationship manager for each client',
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: 'Customer First',
      description: '99% client satisfaction rate',
    },
    {
      icon: <TrendingUp className="w-6 h-6" />,
      title: 'Growth Focused',
      description: 'Scalable solutions for growing businesses',
    },
  ]

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  }

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
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-semibold">Trusted Solutions</span>
          </div>
          <h2 className="section-title mb-4">
            Comprehensive Business Solutions
          </h2>
          <p className="section-subtitle">
            End-to-end workspace and compliance solutions designed for modern businesses. 
            From virtual offices to complete company registration, we handle everything.
          </p>
        </motion.div>

        {/* Services Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16"
        >
          {services.map((service) => (
            <motion.div
              key={service.id}
              variants={itemVariants}
              transition={{ duration: 0.4 }}
              className="card-hover group relative"
            >
              {service.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <div className="badge-premium px-4 py-1.5 text-xs">
                    Most Popular
                  </div>
                </div>
              )}

              <div className="p-8">
                {/* Icon */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${service.gradient} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                  <div className="text-white">
                    {service.icon}
                  </div>
                </div>

                {/* Content */}
                <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-primary-600 transition-colors">
                  {service.title}
                </h3>
                <p className="text-gray-600 mb-6">
                  {service.description}
                </p>

                {/* Features */}
                <ul className="space-y-3">
                  {service.features.map((feature, index) => (
                    <li key={index} className="flex items-center text-sm text-gray-600">
                      <CheckCircle className="w-4 h-4 text-green-500 mr-3 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button className="w-full mt-8 py-3 rounded-lg border-2 border-primary-200 text-primary-700 font-semibold hover:bg-primary-50 hover:border-primary-300 transition-all duration-300 group-hover:shadow-md">
                  Learn More
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Features Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-3xl p-8 sm:p-12"
        >
          <div className="text-center mb-10">
            <h3 className="text-2xl sm:text-3xl font-display font-bold text-gray-900 mb-4">
              Why Choose EaseMyOffice?
            </h3>
            <p className="text-gray-600 max-w-2xl mx-auto">
              We combine technology, expertise, and premium infrastructure to deliver 
              exceptional workspace solutions for businesses of all sizes.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                className="flex items-start space-x-4"
              >
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                    <div className="text-white">
                      {feature.icon}
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">
                    {feature.title}
                  </h4>
                  <p className="text-gray-600">
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="mt-12 pt-8 border-t border-gray-200"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 mb-2">5,000+</div>
                <div className="text-sm text-gray-600">Businesses Served</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 mb-2">200+</div>
                <div className="text-sm text-gray-600">Premium Locations</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 mb-2">30+</div>
                <div className="text-sm text-gray-600">Cities Across India</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 mb-2">99%</div>
                <div className="text-sm text-gray-600">Satisfaction Rate</div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

export default ServicesSection