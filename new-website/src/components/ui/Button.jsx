import { Link } from 'react-router-dom'

const variants = {
  primary: 'bg-primary text-white hover:bg-primary-light shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30',
  secondary: 'bg-white text-primary border-2 border-primary hover:bg-primary hover:text-white',
  outline: 'bg-transparent text-primary border border-primary/30 hover:border-primary hover:bg-primary/5',
  white: 'bg-white text-primary hover:bg-gray-50 shadow-lg',
}

const sizes = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  href,
  to,
  className = '',
  ...props
}) {
  const baseClasses = `inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 ${variants[variant]} ${sizes[size]} ${className}`

  if (to) {
    return (
      <Link to={to} className={baseClasses} {...props}>
        {children}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={baseClasses} {...props}>
        {children}
      </a>
    )
  }

  return (
    <button className={baseClasses} {...props}>
      {children}
    </button>
  )
}
