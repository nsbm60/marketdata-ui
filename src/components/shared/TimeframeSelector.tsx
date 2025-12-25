// src/components/shared/TimeframeSelector.tsx
import Select from "./Select";
import { formatCloseDateShort } from "../../services/closePrices";
import { TimeframeOption } from "../../services/marketState";

interface TimeframeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  timeframes: TimeframeOption[];
  alignRight?: boolean;
}

export default function TimeframeSelector({
  value,
  onChange,
  timeframes,
  alignRight = false,
}: TimeframeSelectorProps) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        ...(alignRight ? { marginLeft: "auto" } : {}),
      }}
    >
      <b>vs:</b>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {timeframes.map((tf) => (
          <option key={tf.id} value={tf.id}>
            {formatCloseDateShort(tf.date)}
            {tf.label ? ` (${tf.label})` : ""}
          </option>
        ))}
      </Select>
    </span>
  );
}
