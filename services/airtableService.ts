// src/services/airtableService.ts

const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID;
const INSTALLERS_TABLE = import.meta.env.VITE_AIRTABLE_INSTALLERS_TABLE || 'Installers';
const JOBS_TABLE = import.meta.env.VITE_AIRTABLE_JOBS_TABLE || 'Installation Jobs';
const PAYMENTS_TABLE = import.meta.env.VITE_AIRTABLE_PAYMENTS_TABLE || 'Installer Payments';
const NOTIFICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_NOTIFICATIONS_TABLE || 'Notifications';

const AIRTABLE_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

interface AirtableRecord {
  id?: string;
  fields: Record<string, any>;
}

interface InstallerApplication {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  serviceRadius: number;
  licenseNumber?: string;
  insuranceExpiry?: string;
  calendarLink?: string;
  paymentMethod: string;
  bankInfo?: string;
  hourlyRate?: number;
  notes?: string;
}

interface InstallationJob {
  shopifyOrderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress: string;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
  installationFee: number;
  status?: string;
}

/**
 * Generic Airtable API request handler
 */
async function airtableRequest(
  method: string,
  table: string,
  body?: any
): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable credentials not configured');
  }

  const url = `${AIRTABLE_API_URL}/${encodeURIComponent(table)}`;
  
  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Airtable API Error:', error);
    throw new Error(`Airtable API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Submit installer application
 */
export async function submitInstallerApplication(
  application: InstallerApplication
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const record: AirtableRecord = {
      fields: {
        'Business Name': application.businessName,
        'Contact Name': application.contactName,
        'Email': application.email,
        'Phone': application.phone,
        'Address': application.address,
        'City': application.city,
        'Province': application.province,
        'Postal Code': application.postalCode,
        'Service Radius': application.serviceRadius,
        'Status': 'Pending',
        'Rating': 0,
        'Total Jobs': 0,
      }
    };

    // Add optional fields
    if (application.licenseNumber) {
      record.fields['License Number'] = application.licenseNumber;
    }
    if (application.insuranceExpiry) {
      record.fields['Insurance Expiry'] = application.insuranceExpiry;
    }
    if (application.calendarLink) {
      record.fields['Calendar Link'] = application.calendarLink;
    }
    if (application.paymentMethod) {
      record.fields['Payment Method'] = application.paymentMethod;
    }
    if (application.bankInfo) {
      record.fields['Bank Info'] = application.bankInfo;
    }
    if (application.hourlyRate) {
      record.fields['Hourly Rate'] = application.hourlyRate;
    }
    if (application.notes) {
      record.fields['Notes'] = application.notes;
    }

    const result = await airtableRequest('POST', INSTALLERS_TABLE, { fields: record.fields });

    // Create notification for admin
    await createNotification({
      recipientType: 'Admin',
      recipientEmail: 'admin@gcitires.com', // Replace with your admin email
      type: 'Application Received',
      title: 'New Installer Application',
      message: `${application.businessName} (${application.contactName}) has submitted an installer application.`,
    });

    return {
      success: true,
      recordId: result.id,
    };
  } catch (error) {
    console.error('Error submitting installer application:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create installation job
 */
export async function createInstallationJob(
  job: InstallationJob
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const record: AirtableRecord = {
      fields: {
        'Shopify Order ID': job.shopifyOrderId,
        'Customer Name': job.customerName,
        'Customer Email': job.customerEmail,
        'Customer Address': job.customerAddress,
        'Tire Brand': job.tireBrand,
        'Tire Model': job.tireModel,
        'Tire Size': job.tireSize,
        'Quantity': job.quantity,
        'Installation Fee': job.installationFee,
        'Status': job.status || 'Pending',
      }
    };

    if (job.customerPhone) {
      record.fields['Customer Phone'] = job.customerPhone;
    }

    const result = await airtableRequest('POST', JOBS_TABLE, { fields: record.fields });

    return {
      success: true,
      recordId: result.id,
    };
  } catch (error) {
    console.error('Error creating installation job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get installer by email
 */
export async function getInstallerByEmail(email: string): Promise<any | null> {
  try {
    const formula = `{Email} = '${email}'`;
    const url = `${AIRTABLE_API_URL}/${encodeURIComponent(INSTALLERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const data = await response.json();
    
    if (data.records && data.records.length > 0) {
      return {
        id: data.records[0].id,
        ...data.records[0].fields,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching installer:', error);
    return null;
  }
}

/**
 * Get jobs for installer
 */
export async function getInstallerJobs(installerId: string): Promise<any[]> {
  try {
    const formula = `{Assigned Installer} = '${installerId}'`;
    const url = `${AIRTABLE_API_URL}/${encodeURIComponent(JOBS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Created Date&sort[0][direction]=desc`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const data = await response.json();
    return data.records || [];
  } catch (error) {
    console.error('Error fetching installer jobs:', error);
    return [];
  }
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: string,
  installerNotes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fields: Record<string, any> = { 'Status': status };
    
    if (status === 'Completed') {
      fields['Completed Date'] = new Date().toISOString();
    }
    
    if (installerNotes) {
      fields['Installer Notes'] = installerNotes;
    }

    await airtableRequest('PATCH', `${JOBS_TABLE}/${jobId}`, { fields });

    return { success: true };
  } catch (error) {
    console.error('Error updating job status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create notification
 */
export async function createNotification(notification: {
  recipientType: string;
  recipientEmail: string;
  type: string;
  title: string;
  message: string;
}): Promise<void> {
  try {
    await airtableRequest('POST', NOTIFICATIONS_TABLE, {
      fields: {
        'Recipient Type': notification.recipientType,
        'Recipient Email': notification.recipientEmail,
        'Type': notification.type,
        'Title': notification.title,
        'Message': notification.message,
        'Read': false,
        'Email Sent': false,
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

/**
 * Get pending installer applications (Admin)
 */
export async function getPendingApplications(): Promise<any[]> {
  try {
    const formula = `{Status} = 'Pending'`;
    const url = `${AIRTABLE_API_URL}/${encodeURIComponent(INSTALLERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Application Date&sort[0][direction]=desc`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const data = await response.json();
    return data.records || [];
  } catch (error) {
    console.error('Error fetching pending applications:', error);
    return [];
  }
}

/**
 * Approve installer application (Admin)
 */
export async function approveInstaller(
  installerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await airtableRequest('PATCH', `${INSTALLERS_TABLE}/${installerId}`, {
      fields: {
        'Status': 'Approved',
        'Approved Date': new Date().toISOString().split('T')[0],
      }
    });

    return { success: true };
 } catch (error) {
  console.error('Error submitting installer application:', error);
  
  // Log the full error for debugging
  if (error instanceof Error) {
    console.error('Error details:', error.message);
  }
  
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}
