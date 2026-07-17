import { Building2, Users, Video, FileCheck } from 'lucide-react'

export const services = [
  {
    icon: Building2,
    title: 'Virtual Office',
    description: 'Premium business address for GST registration, company incorporation, and official correspondence. Get a professional identity without the overhead.',
    link: '/virtual-office',
    features: ['Business address', 'GST registration support', 'Company registration address', 'Mail handling'],
  },
  {
    icon: Users,
    title: 'Coworking Spaces',
    description: 'Dedicated seats and private cabins in premium locations. Flexible plans with high-speed internet, meeting rooms, and all amenities included.',
    link: '/coworking',
    features: ['Dedicated seats', 'Private cabins', 'High-speed WiFi', 'All amenities included'],
  },
  {
    icon: Video,
    title: 'Meeting Rooms',
    description: 'Professional meeting and conference rooms available on hourly or daily basis. Perfect for client meetings, interviews, and team sessions.',
    link: '/meeting-rooms',
    features: ['Hourly booking', 'Daily booking', 'Video conferencing', 'Professional setup'],
  },
  {
    icon: FileCheck,
    title: 'CA Services',
    description: 'End-to-end compliance services including GST registration, company incorporation, ITR filing, and trademark registration by verified CAs.',
    link: '/ca-services',
    features: ['GST registration', 'Company registration', 'ITR filing', 'Trademark registration'],
  },
]
