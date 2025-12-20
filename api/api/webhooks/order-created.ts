import type { VercelRequest, VercelResponse } from '@vercel/node';
import { updateInstallationJob } from '../../src/services/airtableService';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const order = req.body;
    
    // Check if order has installation
    const hasInstallation = order.note_attributes?.find(
      (attr: any) => attr.name === '_installation' && attr.value === 'true'
    );

    if (hasInstallation) {
      // Find pending job with this order ID pattern
      const pendingJobId = `PENDING-${order.id}`;
      
      // Update job in Airtable
      await updateInstallationJob(pendingJobId, {
        shopifyOrderId: order.name, // e.g., #1001
        status: 'Confirmed',
        customerName: order.customer.first_name + ' ' + order.customer.last_name,
        customerEmail: order.customer.email,
        customerPhone: order.customer.phone,
        customerAddress: order.shipping_address.address1
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
