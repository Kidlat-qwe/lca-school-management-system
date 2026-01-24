import { useState, useRef, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { apiRequest } from '../config/api';

/**
 * MerchandiseImageUpload Component (S3 Version)
 * Handles image upload to AWS S3 via backend API with cropping
 * 
 * @param {string} currentImageUrl - Current image URL (if editing)
 * @param {function} onImageUploaded - Callback when image is uploaded (receives imageUrl)
 * @param {string} merchandiseName - Name of merchandise (for file naming)
 * @param {number} merchandiseId - ID of merchandise (for file naming)
 */
const MerchandiseImageUploadS3 = ({ currentImageUrl, onImageUploaded, merchandiseName, merchandiseId }) => {
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl || null);
  const [imageSrc, setImageSrc] = useState(null); // For cropping
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // Helper function to create image from URL
  const createImage = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image));
      image.addEventListener('error', (error) => reject(error));
      image.src = url;
    });

  // Get cropped image as blob
  const getCroppedImg = async (imageSrc, pixelCrop) => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('No 2d context');
    }

    // Set canvas size to match cropped area
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    // Draw cropped image
    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    // Convert canvas to blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.95);
    });
  };

  const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setImageSrc(reader.result);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    });
    reader.readAsDataURL(file);
  };

  const handleCropAndUpload = async () => {
    if (!imageSrc || !croppedAreaPixels) {
      setError('Please select and crop an image');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Get cropped image blob
      const croppedImageBlob = await getCroppedImg(imageSrc, croppedAreaPixels);

      // Create FormData for upload
      const formData = new FormData();
      formData.append('image', croppedImageBlob, 'merchandise.jpg');
      formData.append('merchandiseName', merchandiseName || 'merchandise');
      if (merchandiseId) {
        formData.append('merchandiseId', merchandiseId.toString());
      }

      // Upload to S3 via backend API
      const response = await apiRequest('/upload/merchandise-image', {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type, let browser set it with boundary
          // Authorization header is added automatically by apiRequest
        },
      });

      console.log('Upload successful:', response);

      const imageUrl = response.imageUrl;

      // Update preview and call callback
      setPreviewUrl(imageUrl);
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);

      // Call callback with image URL
      if (onImageUploaded) {
        onImageUploaded(imageUrl);
      }

      setUploading(false);
    } catch (err) {
      console.error('Error uploading image:', err);
      setError(err.message || 'Failed to upload image');
      setUploading(false);
    }
  };

  const handleCancelCrop = () => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = () => {
    setPreviewUrl(null);
    setImageSrc(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (onImageUploaded) {
      onImageUploaded(null); // Pass null to remove image
    }
  };

  return (
    <div className="space-y-3">
      <label className="label-field">
        Merchandise Image
      </label>
      
      {/* Image Cropper - Show when image is selected */}
      {imageSrc && (
        <div className="space-y-4">
          <div className="relative w-full h-64 bg-gray-900 rounded-lg overflow-hidden">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1} // Square aspect ratio for merchandise cards
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              cropShape="rect"
              showGrid={true}
            />
          </div>

          {/* Zoom Control */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Zoom: {Math.round(zoom * 100)}%
            </label>
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Crop Actions */}
          <div className="flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={handleCancelCrop}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCropAndUpload}
              className="px-4 py-2 text-sm font-medium text-white bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
              disabled={uploading || !croppedAreaPixels}
            >
              {uploading ? (
                <span className="flex items-center space-x-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Uploading...</span>
                </span>
              ) : (
                'Crop & Upload'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Image Preview - Show when image is uploaded (not cropping) */}
      {previewUrl && !imageSrc && (
        <div className="relative w-full aspect-square bg-gray-100 rounded-lg overflow-hidden border-2 border-gray-200">
          <img
            src={previewUrl}
            alt="Merchandise preview"
            className="w-full h-full object-cover object-center"
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
            title="Remove image"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Upload Button / File Input - Show when not cropping */}
      {!imageSrc && (
        <div className="flex items-center space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            id="merchandise-image-upload"
            disabled={uploading}
          />
          <label
            htmlFor="merchandise-image-upload"
            className={`flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
              uploading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <span className="flex items-center space-x-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{previewUrl ? 'Change Image' : 'Upload Image'}</span>
            </span>
          </label>
          {!previewUrl && (
            <p className="text-xs text-gray-500">
              Recommended: Square image, max 5MB
            </p>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
};

export default MerchandiseImageUploadS3;

