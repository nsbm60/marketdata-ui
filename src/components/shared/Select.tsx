// src/components/shared/Select.tsx
import { SelectHTMLAttributes, forwardRef } from "react";
import { light } from "../../theme";

type SelectSize = "sm" | "md" | "form";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  size?: SelectSize;
}

const sizeStyles: Record<SelectSize, React.CSSProperties> = {
  sm: {
    padding: "2px 20px 2px 6px",
    fontSize: 11,
  },
  md: {
    padding: "4px 24px 4px 8px",
    fontSize: 12,
  },
  form: {
    width: "100%",
    padding: "10px 28px 10px 10px",
    fontSize: 14,
    borderRadius: 8,
  },
};

const baseStyle: React.CSSProperties = {
  border: `1px solid ${light.border.secondary}`,
  borderRadius: 4,
  background: light.bg.primary,
  color: light.text.primary,
  colorScheme: "light",
  cursor: "pointer",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M3 4.5L6 8l3-3.5H3z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 4px center",
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = "sm", style, className, ...props }, ref) => {
    const combinedStyle: React.CSSProperties = {
      ...baseStyle,
      ...sizeStyles[size],
      ...style,
    };

    return <select ref={ref} style={combinedStyle} className={className} {...props} />;
  }
);

Select.displayName = "Select";

export default Select;
