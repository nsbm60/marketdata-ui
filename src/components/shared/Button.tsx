// src/components/shared/Button.tsx
import { ButtonHTMLAttributes, forwardRef } from "react";
import { light, semantic } from "../../theme";

type ButtonVariant = "primary" | "secondary" | "danger" | "success";
type ButtonSize = "sm" | "md" | "form";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    padding: "4px 10px",
    fontSize: 11,
    borderRadius: 4,
  },
  md: {
    padding: "8px 16px",
    fontSize: 13,
    borderRadius: 6,
  },
  form: {
    padding: "10px 16px",
    fontSize: 14,
    borderRadius: 8,
  },
};

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: semantic.info.bg,
    color: semantic.info.text,
    border: `1px solid ${semantic.info.text}`,
  },
  secondary: {
    background: light.bg.primary,
    color: light.text.primary,
    border: `1px solid ${light.border.secondary}`,
  },
  danger: {
    background: semantic.error.text,
    color: light.bg.primary,
    border: "none",
  },
  success: {
    background: semantic.success.bg,
    color: semantic.success.textDark,
    border: `1px solid ${semantic.success.text}`,
  },
};

const baseStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 500,
  colorScheme: "light", // Prevents macOS dark mode from overriding text color
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", style, className, disabled, ...props }, ref) => {
    const combinedStyle: React.CSSProperties = {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...(disabled ? { opacity: 0.5, cursor: "not-allowed" } : {}),
      ...style,
    };

    return (
      <button
        ref={ref}
        style={combinedStyle}
        className={className}
        disabled={disabled}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export default Button;
