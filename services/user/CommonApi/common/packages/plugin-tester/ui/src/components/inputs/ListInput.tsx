import { ReactNode } from "react";
import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";

interface ListInputProps {
  itemType: unknown;
  schema: Schema;
  value: unknown[];
  onChange: (value: unknown[]) => void;
  label?: ReactNode;
}

export const ListInput = ({
  itemType,
  schema,
  value,
  onChange,
  label,
}: ListInputProps) => {
  const handleAddItem = () => {
    onChange([...value, ""]);
  };

  const handleRemoveItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, newValue: unknown) => {
    const newList = [...value];
    newList[index] = newValue;
    onChange(newList);
  };

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <div className="list-items">
        {value.map((item, index) => (
          <div key={index} className="list-item">
            <TypeBasedInput
              type={itemType}
              schema={schema}
              value={item}
              onChange={(newValue) => handleItemChange(index, newValue)}
            />
            <button
              className="common-button remove-item"
              onClick={() => handleRemoveItem(index)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="common-button add-item" onClick={handleAddItem}>
        Add Item
      </button>
    </div>
  );
};
