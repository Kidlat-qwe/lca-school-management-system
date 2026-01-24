import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import { apiRequest } from '../config/api';
import { useAuth } from '../contexts/AuthContext';

// Helper function to create image from URL
const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.src = url;
  });

const ProfilePictureModalS3 = ({ isOpen, onClose, currentProfilePicture }) => {
  const { userInfo, refreshUserInfo } = useAuth();
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

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
    });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) {
      setError('Please select and crop an image');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Get cropped image blob
      const croppedImageBlob = await getCroppedImg(imageSrc, croppedAreaPixels);

      // Get user ID
      const userId = userInfo?.user_id || userInfo?.userId;

      // Create FormData for upload
      const formData = new FormData();
      formData.append('image', croppedImageBlob, 'avatar.jpg');

      // Upload to S3 via backend API
      const uploadResponse = await apiRequest('/upload/user-avatar', {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type, let browser set it with boundary
          // Authorization header is added automatically by apiRequest
        },
      });

      console.log('Upload successful:', uploadResponse);

      const profilePictureUrl = uploadResponse.imageUrl;

      // Update user profile in database
      const updateResponse = await apiRequest(`/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          profile_picture_url: profilePictureUrl,
        }),
      });

      if (updateResponse && updateResponse.success) {
        // Refresh user info in context
        const updatedUser = await refreshUserInfo();
        console.log('Profile picture updated, new user info:', updatedUser);
        onClose();
        // Reset state
        setImageSrc(null);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
      } else {
        throw new Error('Failed to update profile picture');
      }
    } catch (err) {
      console.error('Error uploading profile picture:', err);
      setError(err.message || 'Failed to upload profile picture. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const handleRemove = async () => {
    if (!window.confirm('Are you sure you want to remove your profile picture?')) {
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const userId = userInfo?.user_id || userInfo?.userId;

      // Update user profile to remove picture URL
      const response = await apiRequest(`/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          profile_picture_url: null,
        }),
      });

      if (response && response.success) {
        // Refresh user info in context
        await refreshUserInfo();
        onClose();
      } else {
        throw new Error('Failed to remove profile picture');
      }
    } catch (err) {
      console.error('Error removing profile picture:', err);
      setError(err.message || 'Failed to remove profile picture. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
            <h2 className="text-xl font-semibold text-gray-900">Change Profile Picture</h2>
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={uploading}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="p-6 overflow-y-auto flex-1 min-h-0">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            {!imageSrc ? (
              <div className="space-y-4">
                {/* Current Profile Picture Preview */}
                {currentProfilePicture && (
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-2">Current Profile Picture</p>
                    <div className="inline-block">
                      <img
                        src={currentProfilePicture}
                        alt="Current profile"
                        className="w-32 h-32 rounded-full object-cover mx-auto border-4 border-gray-200"
                      />
                    </div>
                  </div>
                )}

                {/* File Input */}
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="profile-picture-input"
                  />
                  <label
                    htmlFor="profile-picture-input"
                    className="cursor-pointer flex flex-col items-center space-y-4"
                  >
                    <svg
                      className="w-12 h-12 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Click to upload a new profile picture
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        PNG, JPG, GIF up to 5MB
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Cropper */}
                <div className="relative w-full h-96 bg-gray-100 rounded-lg overflow-hidden">
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                    cropShape="round"
                    showGrid={false}
                  />
                </div>

                {/* Zoom Controls */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Zoom: {Math.round(zoom * 100)}%
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>100%</span>
                    <span>300%</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer - Fixed at bottom */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <div>
              {currentProfilePicture && !imageSrc && (
                <button
                  onClick={handleRemove}
                  className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
                  disabled={uploading}
                >
                  Remove Picture
                </button>
              )}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                disabled={uploading}
              >
                Cancel
              </button>
              {imageSrc && (
                <button
                  onClick={handleSave}
                  disabled={uploading || !croppedAreaPixels}
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] rounded-md hover:bg-[#F5B82E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Uploading...' : 'Save'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePictureModalS3;

