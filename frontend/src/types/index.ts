export interface BaseComponentProps {
  className?: string
  children?: React.ReactNode
}

export interface VariantProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export interface ButtonProps extends BaseComponentProps, VariantProps {
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

export interface InputProps extends BaseComponentProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  required?: boolean
  error?: string
}

export interface CardProps extends BaseComponentProps {
  title?: string
  description?: string
}

export interface BadgeProps extends BaseComponentProps {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
}
