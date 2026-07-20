import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Star, 
  Quote, 
  ChevronLeft, 
  ChevronRight,
  Building2,
  Users,
  Award,
  TrendingUp
} from 'lucide-react'
import { useInView } from 'react-intersection-observer'

interface Testimonial {
  id: number
  name: string
  role: string
  company: string
  rating: number
  content: string
  image: string
  service: string
}

const TestimonialsSection: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0)
  const [autoPlay, setAutoPlay] = useState(true)
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  })

  const testimonials: Testimonial[] = [
    {
      id: 1,
      name: 'Rajesh Kumar',
      role: 'Founder & CEO',
      company: 'TechNova Solutions',
      rating: 5,
      content: 'EaseMyOffice made our company registration and virtual office setup incredibly smooth. Their compliance support team is exceptional. Highly recommended for startups!',
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rajesh',
      service: 'Company Registration',
    },
    {
      id: 2,
      name: 'Priya Sharma',
      role: 'Operations Director',
      company: 'Global Exporters Ltd',
      rating: 5,
      content: 'The premium business address we got through EaseMyOffice has significantly boosted our credibility. The mail handling and compliance services are top-notch.',
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Priya',
      service: 'Virtual Office',
    },
    {
      id: 3,
      name: 'Amit Patel',
      role: 'Managing Partner',
      company: 'Innovate Capital',
      rating: 5,
      content: 'We\'ve been using their coworking spaces across multiple cities. The facilities are excellent, and their team is always responsive to our needs.',
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Amit',
      service: 'Coworking Space',
    },
    {
      id: 4,
      name: 'Sunita Reddy',
      role: 'Finance Head',
      company: 'HealthFirst Pharma',
      rating: 5,
      content: 'Their GST compliance and annual filing services have saved us countless hours. Professional, reliable, and cost-effective service.',
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sunita',
      service: 'Compliance Services',
    },
    {
      id: 5,
      name: 'Vikram Singh',
      role: 'Startup Founder',
      company: 'AppWorks Inc',
      rating: 5,
      content: 'Perfect solution for remote teams. The virtual office gave us a professional presence while keeping costs low during our early stages.',
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vikram',
      service: 'Virtual Office',
    },
  ]

  const stats = [
    {
      icon: <Building2 className="w-6 h-6" />,
      value: '5,000+',
      label: 'Happy Clients',
    },
    {
      icon: <Star className="w-6 h-6" />,
      value: '4.9/5',
      label: 'Average Rating',
    },
    {
      icon: <Users className="w-6 h-6" />,
      value: '200+',
      label: 'Team Members',
    },
    {
      icon: <TrendingUp className="w-6 h-6" />,
      value: '98%',
      label: 'Retention Rate',
    },
  ]

  useEffect(() => {
    if (!autoPlay || !inView) return

    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length)
    }, 5000)

    return () => clearInterval(interval)
  }, [autoPlay, inView, testimonials.length])

  const handlePrevious = () => {
    setAutoPlay(false)
    setActiveIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length)
  }

  const handleNext = () => {
    setAutoPlay(false)
    setActiveIndex((prev) => (prev + 1) % testimonials.length)
  }

  const handleDotClick = (index: number) => {
    setAutoPlay(false)
    setActiveIndex(index)
  }

  return (
    <section ref={ref} className="section-padding bg-gradient-to-b from-gray-50 to-white">
      <div className="container-custom">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center space-x-2 bg-primary-50 text-primary-700 px-4 py-2 rounded-full mb-4">
            <Quote className="w-4 h-4" />
            <span className="text-sm font-semibold">Client Stories</span>
          </div>
          <h2 className="section-title mb-4">
            Trusted by Industry Leaders
          </h2>
          <p className="section-subtitle">
            Join 5,000+ businesses who have transformed their workspace and compliance 
            management with our premium solutions.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-12">
          {/* Left Column - Stats */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8"
          >
            <div className="bg-gradient-to-br from-primary-50 to-white rounded-2xl p-8 shadow-elegant">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">
                Our Impact in Numbers
              </h3>
              
              <div className="space-y-6">
                {stats.map((stat, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={inView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                        <div className="text-primary-600">
                          {stat.icon}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">{stat.label}</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {stat.value}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-8 pt-8 border-t border-gray-200">
                <div className="flex items-center space-x-2">
                  <Award className="w-5 h-5 text-yellow-500" />
                  <span className="font-semibold text-gray-900">
                    Awarded "Best Workspace Solutions Provider 2024"
                  </span>
                </div>
              </div>
            </div>

            {/* Review Platforms */}
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100">
              <h4 className="font-semibold text-gray-900 mb-4">
                Verified Reviews
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <span className="text-blue-600 font-bold">G</span>
                    </div>
                    <span className="text-gray-700">Google Reviews</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 text-yellow-500 fill-current" />
                    ))}
                    <span className="font-semibold text-gray-900">4.9</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                      <span className="text-orange-600 font-bold">T</span>
                    </div>
                    <span className="text-gray-700">Trustpilot</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 text-yellow-500 fill-current" />
                    ))}
                    <span className="font-semibold text-gray-900">4.8</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Column - Testimonials Carousel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="lg:col-span-2"
          >
            <div className="relative">
              <div className="absolute -top-6 -left-6 w-12 h-12 bg-gradient-to-br from-primary-100 to-accent-100 rounded-2xl flex items-center justify-center">
                <Quote className="w-6 h-6 text-primary-600" />
              </div>

              <div className="bg-white rounded-2xl shadow-elegant p-8 md:p-12">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeIndex}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    {/* Rating */}
                    <div className="flex items-center space-x-1 mb-6">
                      {[...Array(testimonials[activeIndex].rating)].map((_, i) => (
                        <Star key={i} className="w-5 h-5 text-yellow-500 fill-current" />
                      ))}
                      <span className="ml-2 text-sm text-gray-600">
                        {testimonials[activeIndex].rating}.0 Rating
                      </span>
                    </div>

                    {/* Content */}
                    <blockquote className="text-xl sm:text-2xl font-display font-medium text-gray-900 mb-8 leading-relaxed">
                      "{testimonials[activeIndex].content}"
                    </blockquote>

                    {/* Author */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-primary-100 to-accent-100">
                          <img 
                            src={testimonials[activeIndex].image} 
                            alt={testimonials[activeIndex].name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">
                            {testimonials[activeIndex].name}
                          </div>
                          <div className="text-gray-600">
                            {testimonials[activeIndex].role}
                          </div>
                          <div className="text-sm text-primary-600 font-medium">
                            {testimonials[activeIndex].company}
                          </div>
                        </div>
                      </div>

                      {/* Service Badge */}
                      <div className="hidden sm:block">
                        <div className="badge-primary px-4 py-2">
                          {testimonials[activeIndex].service}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-8 pt-8 border-t border-gray-200">
                  <div className="flex items-center space-x-2">
                    {testimonials.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => handleDotClick(index)}
                        className={`w-2 h-2 rounded-full transition-all ${
                          index === activeIndex 
                            ? 'bg-primary-600 w-6' 
                            : 'bg-gray-300 hover:bg-gray-400'
                        }`}
                        aria-label={`Go to testimonial ${index + 1}`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      onClick={handlePrevious}
                      className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50 transition-colors"
                      aria-label="Previous testimonial"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-700" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50 transition-colors"
                      aria-label="Next testimonial"
                    >
                      <ChevronRight className="w-5 h-5 text-gray-700" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Decorative Elements */}
              <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-gradient-to-br from-accent-100 to-primary-100 rounded-2xl -z-10" />
            </div>

            {/* Client Logos */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="mt-12"
            >
              <div className="text-center mb-6">
                <p className="text-gray-600 font-medium">
                  Trusted by leading companies
                </p>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-6">
                {[
                  { name: 'Shiprocket', color: 'from-blue-500 to-blue-600' },
                  { name: 'IndiaMART', color: 'from-orange-500 to-orange-600' },
                  { name: 'Verizon', color: 'from-red-500 to-red-600' },
                  { name: "Dr. Reddy's", color: 'from-green-500 to-green-600' },
                  { name: 'Udaan', color: 'from-purple-500 to-purple-600' },
                  { name: 'Xpressbees', color: 'from-yellow-500 to-yellow-600' },
                ].map((company, index) => (
                  <div
                    key={index}
                    className="bg-white rounded-xl p-4 flex items-center justify-center shadow-soft border border-gray-100 hover:shadow-elegant transition-shadow"
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${company.color} flex items-center justify-center`}>
                      <span className="text-white font-bold text-sm">
                        {company.name.charAt(0)}
                      </span>
                    </div>
                    <span className="ml-3 font-semibold text-gray-900">
                      {company.name}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export default TestimonialsSection