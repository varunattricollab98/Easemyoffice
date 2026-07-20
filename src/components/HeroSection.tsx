import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { 
  ArrowRight, 
  Building2, 
  MapPin, 
  Users, 
  CheckCircle,
  Sparkles,
  Award,
  Shield
} from 'lucide-react'
import { useInView } from 'react-intersection-observer'

interface HeroSectionProps {
  variant?: 'default' | 'virtual-office' | 'coworking'
  title?: string
  subtitle?: string
}

const HeroSection: React.FC<HeroSectionProps> = ({
  variant = 'default',
  title,
  subtitle
}) => {
  const [stats, setStats] = useState([
    { value: '5000+', label: 'Businesses Served', icon: <Building2 /> },
    { value: '30+', label: 'Cities Across India', icon: <MapPin /> },
    { value: '200+', label: 'Premium Locations', icon: <Award /> },
    { value: '99%', label: 'Client Satisfaction', icon: <CheckCircle /> },
  ])

  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  })

  const getHeroContent = () => {
    switch (variant) {
      case 'virtual-office':
        return {
          title: 'Premium Virtual Office Solutions Across India',
          subtitle: 'Get a professional business address, company registration, GST services, and compliance support — no physical office required. Trusted by 5,000+ businesses.',
          gradient: 'from-blue-600 to-indigo-700',
          bgClass: 'bg-gradient-to-br from-blue-50 via-white to-indigo-50',
        }
      case 'coworking':
        return {
          title: 'Flexible Coworking Spaces & Managed Offices',
          subtitle: 'Discover premium coworking spaces, private cabins, and managed offices in 30+ cities. Perfect for startups, enterprises, and remote teams.',
          gradient: 'from-green-600 to-emerald-700',
          bgClass: 'bg-gradient-to-br from-green-50 via-white to-emerald-50',
        }
      default:
        return {
          title: title || 'Premium Workspace Solutions for Modern Businesses',
          subtitle: subtitle || 'India\'s leading platform for virtual offices, coworking spaces, company registration, and business compliance services. Trusted by 5,000+ brands.',
          gradient: 'from-primary-600 to-accent-600',
          bgClass: 'gradient-bg',
        }
    }
  }

  const content = getHeroContent()

  return (
    <section className={`relative overflow-hidden ${content.bgClass}`}>
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-64 h-64 bg-gradient-to-br from-primary-100/20 to-accent-100/20 rounded-full -translate-x-32 -translate-y-32" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-gradient-to-br from-primary-100/10 to-accent-100/10 rounded-full translate-x-48 translate-y-48" />
        
        {/* Grid Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(to right, #3b82f6 1px, transparent 1px),
                             linear-gradient(to bottom, #3b82f6 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }} />
        </div>
      </div>

      <div className="relative container-custom section-padding">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <motion.div
            ref={ref}
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="inline-flex items-center space-x-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-200 shadow-soft"
            >
              <Sparkles className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-semibold text-gray-700">
                Trusted by 5,000+ Businesses
              </span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-gray-900 leading-tight"
            >
              <span className="block">{content.title.split(' ').slice(0, 2).join(' ')}</span>
              <span className={`block bg-gradient-to-r ${content.gradient} bg-clip-text text-transparent`}>
                {content.title.split(' ').slice(2).join(' ')}
              </span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-lg sm:text-xl text-gray-600 max-w-2xl"
            >
              {content.subtitle}
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <button className="btn-primary group">
                <span>Get Free Consultation</span>
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="btn-secondary">
                <span>View All Services</span>
              </button>
            </motion.div>

            {/* Trust Indicators */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="pt-8 border-t border-gray-200"
            >
              <div className="flex items-center space-x-6 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-primary-600" />
                  <span>100% Compliance Guarantee</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Award className="w-5 h-5 text-primary-600" />
                  <span>Premium Locations</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-primary-600" />
                  <span>Verified Reviews</span>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* Right Content - Stats & Visual */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative"
          >
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-6">
              {stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={inView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                  className="stat-card"
                >
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                        <div className="text-white">
                          {stat.icon}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {stat.value}
                      </div>
                      <div className="text-sm text-gray-600">
                        {stat.label}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Floating Office Image */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.7 }}
              className="mt-8 relative"
            >
              <div className="absolute -inset-4 bg-gradient-to-r from-primary-500/10 to-accent-500/10 rounded-3xl blur-xl" />
              <div className="relative bg-white rounded-2xl shadow-elegant overflow-hidden">
                <div className="aspect-video bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                  <div className="text-center p-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Building2 className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Premium Office Spaces
                    </h3>
                    <p className="text-sm text-gray-600">
                      Browse 200+ verified locations
                    </p>
                  </div>
                </div>
              </div>

              {/* Floating Elements */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute -top-4 -right-4 bg-white p-3 rounded-xl shadow-elegant"
              >
                <Users className="w-6 h-6 text-primary-600" />
              </motion.div>
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
                className="absolute -bottom-4 -left-4 bg-white p-3 rounded-xl shadow-elegant"
              >
                <MapPin className="w-6 h-6 text-accent-600" />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 1, delay: 1 }}
          className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
        >
          <div className="flex flex-col items-center">
            <span className="text-sm text-gray-500 mb-2">Scroll to explore</span>
            <div className="w-6 h-10 border-2 border-gray-300 rounded-full flex justify-center">
              <motion.div
                animate={{ y: [0, 12, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-1 h-3 bg-primary-500 rounded-full mt-2"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

export default HeroSection