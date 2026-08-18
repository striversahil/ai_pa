'use client';
import { useCallback } from 'react';
import type { Enquiry } from '../types';

export function useCSV(showToast: (text: string, type?: string) => void) {
  const exportCSV = useCallback((enquiries: Enquiry[]) => {
    if (enquiries.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }
    const headers = ['ID', 'Company', 'Title', 'Contact Name', 'Contact Email', 'Contact Phone', 'Priority', 'Status', 'Value', 'Date Created'];
    const rows = enquiries.map(e => [
      e.id,
      `"${e.clientCompany.replace(/"/g, '""')}"`,
      `"${e.title.replace(/"/g, '""')}"`,
      `"${e.contactName.replace(/"/g, '""')}"`,
      e.contactEmail,
      e.contactPhone,
      e.priority,
      e.status,
      String(e.estimatedValue),
      e.createdAt
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `b2b_enquiries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV file downloaded', 'success');
  }, [showToast]);

  const importCSV = useCallback((e: React.ChangeEvent<HTMLInputElement>, currentAgentId: number): Promise<Enquiry[]> => {
    const file = e.target.files?.[0];
    if (!file) return Promise.resolve([]);
    const reader = new FileReader();
    return new Promise(resolve => {
      reader.onload = (evt) => {
        try {
          const text = evt.target?.result as string;
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length <= 1) { showToast('CSV file is empty', 'warning'); resolve([]); return; }
          const parseLine = (line: string) => {
            const result: string[] = []; let current = ''; let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') inQuotes = !inQuotes;
              else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
              else current += char;
            }
            result.push(current);
            return result;
          };
          const imported: Enquiry[] = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = parseLine(lines[i]);
            if (cols.length < 3) continue;
            const company = cols[1] || 'Imported Company';
            const title = cols[2] || 'Imported Enquiry';
            let priority: Enquiry['priority'] = 'medium';
            if (cols[6]?.toLowerCase() === 'high') priority = 'high';
            if (cols[6]?.toLowerCase() === 'low') priority = 'low';
            const possibleStatus = cols[7]?.toLowerCase() as Enquiry['status'];
            const status: Enquiry['status'] = (['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const).includes(possibleStatus as any) ? possibleStatus : 'new';
            const valueVal = parseFloat(cols[8]);
            imported.push({
              id: `enq-imported-${Date.now()}-${i}`,
              clientCompany: company,
              contactName: cols[3] || 'Contact Name',
              contactEmail: cols[4] || 'imported@email.com',
              contactPhone: cols[5] || '',
              title,
              description: 'Imported via CSV file.',
              priority,
              status,
              assignedAgentId: currentAgentId,
              estimatedValue: isNaN(valueVal) ? 10000 : valueVal,
              createdAt: new Date().toISOString(),
              activities: [{ id: `act-imp-${Date.now()}-${i}`, type: 'creation', text: 'Enquiry imported via CSV upload.', timestamp: new Date().toISOString(), agentId: currentAgentId }]
            });
          }
          if (imported.length > 0) showToast(`Successfully imported ${imported.length} B2B enquiries!`, 'success');
          else showToast('No valid records found to import', 'warning');
          resolve(imported);
        } catch { showToast('Error processing CSV format', 'danger'); resolve([]); }
      };
      reader.readAsText(file);
    }) as Promise<Enquiry[]>;
  }, [showToast]);

  return { exportCSV, importCSV };
}
