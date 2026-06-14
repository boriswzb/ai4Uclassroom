'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

type MoveType = 'IN' | 'OUT' | 'TRANSFER';

interface FormData {
  type: MoveType;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  unit: string;
  reference: string;
  remark: string;
}

const initialFormData: FormData = {
  type: 'IN',
  productName: '',
  warehouseId: '',
  warehouseName: '',
  quantity: '',
  unit: 'pcs',
  reference: '',
  remark: '',
};

export default function NewInventoryMovePage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/erp/api/inventory/moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          quantity: Number(formData.quantity),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create inventory move');
      }

      router.push('/inventory/moves');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Inventory Move</h1>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => router.push('/inventory/moves')}
        >
          Back
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="type" className={styles.label}>
            Move Type
          </label>
          <select
            id="type"
            name="type"
            className={styles.select}
            value={formData.type}
            onChange={handleChange}
            required
          >
            <option value="IN">In</option>
            <option value="OUT">Out</option>
            <option value="TRANSFER">Transfer</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="productName" className={styles.label}>
            Product Name
          </label>
          <input
            type="text"
            id="productName"
            name="productName"
            className={styles.input}
            value={formData.productName}
            onChange={handleChange}
            required
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="warehouseId" className={styles.label}>
              Warehouse ID
            </label>
            <input
              type="text"
              id="warehouseId"
              name="warehouseId"
              className={styles.input}
              value={formData.warehouseId}
              onChange={handleChange}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="warehouseName" className={styles.label}>
              Warehouse Name
            </label>
            <input
              type="text"
              id="warehouseName"
              name="warehouseName"
              className={styles.input}
              value={formData.warehouseName}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="quantity" className={styles.label}>
              Quantity
            </label>
            <input
              type="number"
              id="quantity"
              name="quantity"
              className={styles.input}
              value={formData.quantity}
              onChange={handleChange}
              required
              min="1"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="unit" className={styles.label}>
              Unit
            </label>
            <input
              type="text"
              id="unit"
              name="unit"
              className={styles.input}
              value={formData.unit}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="reference" className={styles.label}>
            Reference
          </label>
          <input
            type="text"
            id="reference"
            name="reference"
            className={styles.input}
            value={formData.reference}
            onChange={handleChange}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="remark" className={styles.label}>
            Remark
          </label>
          <textarea
            id="remark"
            name="remark"
            className={styles.textarea}
            value={formData.remark}
            onChange={handleChange}
            rows={3}
          />
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => router.push('/inventory/moves')}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Move'}
          </button>
        </div>
      </form>
    </div>
  );
}